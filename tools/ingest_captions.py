#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pyyaml"]
# ///
"""Turn hand-written YouTube captions into content/ media + transcripts.

Reads a staging directory of yt-dlp output ({video}.info.json + {video}.en.vtt)
and emits, for each qualifying video:

  content/media/{show}/{id}.yaml
  content/transcripts/{show}/{id}.json

Only HAND-WRITTEN captions are accepted. YouTube's auto-captions carry
word-level timing tags and no speaker labels, which would leave every line
without the speaker the site renders per row — they are skipped, loudly.

Speakers come from the caption's own convention ("Goku: ...", "[GOKU] ..."),
carried forward across continuation cues. A cue wrapped entirely in * ( [ or ♪
is not dialog: fan captions use those for both stage directions and the
captioner's own asides. Both land as non-dialog lines, which the site renders
dim and italic and build-data.mjs keeps out of the search index.

Usage:
  tools/ingest_captions.py --show dbza --kind kai --dir path/to/staging
  tools/ingest_captions.py --show dbza --kind kai --dir path/ --dry-run
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).parent.parent
CONTENT = ROOT / "content"

# id prefix per kind — ids must be globally unique: the frame store keys on the
# bare item (dbza-frames.bool.is/{item}/grid/...), with no show or kind segment
PREFIX = {"kai": "k", "cellvs": "cv", "shortz": "ds", "buu": "b", "hfil": "h", "super": "s"}

TITLE_NOISE = [
    re.compile(r"^Dragon\s?Ball Z KAI Abridged(?: Parody)?:\s*", re.I),
    re.compile(r"^DragonShortZ(?: Special)?[:|]?\s*", re.I),
    re.compile(r"\s*\|\s*Buu Bits.*$", re.I),
    re.compile(r"\s*\|\s*Team\s?Four\s?Star.*$", re.I),
    re.compile(r"\s*[-|]\s*Team\s?Four\s?Star(\s*\(TFS\))?\s*$", re.I),
    re.compile(r"\s*#\w+\s*$"),
]

# "Goku: hi"  /  "[GOKU] hi"  — anchored, short, and followed by real text
SPEAKER_COLON = re.compile(r"^([A-Z][A-Za-z0-9 .'&/-]{0,22}):\s+(?=\S)")
SPEAKER_BRACKET = re.compile(r"^\[([A-Z][A-Za-z0-9 .'&/-]{0,22})\]\s*(?=\S)")
MAX_SPEAKER_WORDS = 3
# Below this share of labelled cues, a file is not written with speaker labels
# and the few matches are almost certainly false — a mid-sentence colon in an
# ad read ("So check out Bleach: Immortal Soul") reads exactly like a label,
# and carrying it forward would brand most of the episode with it.
MIN_LABEL_RATE = 0.2
WRAPPED = re.compile(r"^\s*([\*\(\[♪])(.+?)([\*\)\]♪])\s*$", re.S)
SFX_HINT = re.compile(r"♪|music|theme song|sound (?:clip|effect)|sting|screaming|laugh", re.I)


def clean_title(t: str) -> str:
    for p in TITLE_NOISE:
        t = p.sub("", t)
    return t.strip(" -|:")


def has_human_captions(info: dict) -> bool:
    """yt-dlp files uploaded caption tracks under `subtitles` and machine ones
    under `automatic_captions` — the authoritative split. Text heuristics are
    not enough: some ASR tracks ship without the word-level <c> spans and read
    as plain (useless) lines like "foreign" and "[Music]"."""
    return any(k.startswith("en") for k in (info.get("subtitles") or {}))


def is_auto(vtt: str) -> bool:
    """Belt-and-braces for staging dirs whose info.json predates the split."""
    return "<c>" in vtt or re.search(r"<\d\d:\d\d:\d\d\.\d\d\d>", vtt) is not None


def parse_cues(vtt: str):
    """[(start, end, text)] — tags stripped, entities decoded, cue lines joined."""
    cues, cur, buf = [], None, []
    for raw in vtt.splitlines():
        line = raw.rstrip()
        if "-->" in line:
            if cur and buf:
                cues.append((*cur, " ".join(buf)))
            m = re.search(
                r"(\d+):(\d\d):(\d\d)[.,](\d+)\s*-->\s*(\d+):(\d\d):(\d\d)[.,](\d+)", line
            )
            if not m:
                cur, buf = None, []
                continue
            g = [int(x) for x in m.groups()]
            cur = (g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000,
                   g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000)
            buf = []
        # A cue runs until the next timestamp: YouTube pads cue bodies with
        # whitespace-only lines, and treating those as the terminator drops
        # every line that follows them.
        elif cur and not line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            txt = re.sub(r"<[^>]+>", "", line)
            txt = html.unescape(txt).replace("\xa0", " ")
            txt = re.sub(r"\s+", " ", txt).strip()
            if txt:
                buf.append(txt)
    if cur and buf:
        cues.append((*cur, " ".join(buf)))
    return cues


def split_label(text):
    """('Goku', 'hi') for a labelled cue, else (None, text) with text intact."""
    for pat in (SPEAKER_BRACKET, SPEAKER_COLON):
        m = pat.match(text)
        if m:
            name = m.group(1).strip()
            if 0 < len(name.split()) <= MAX_SPEAKER_WORDS:
                return name, text[m.end():].strip()
    return None, text


def to_lines(cues):
    """Cues → transcript lines, carrying the speaker across continuation cues."""
    spoken = [t for _, _, t in cues if t and not WRAPPED.match(t)]
    labelled = sum(1 for t in spoken if split_label(t)[0])
    use_speakers = bool(spoken) and labelled / len(spoken) >= MIN_LABEL_RATE

    out, last_speaker, prev = [], None, None
    for start, end, text in cues:
        if not text or text == prev:      # drop the repeated-cue artifact
            continue
        prev = text

        w = WRAPPED.match(text)
        if w:
            inner = w.group(2).strip()
            if not inner:
                continue
            out.append({"start": start, "end": end,
                        "kind": "sfx" if SFX_HINT.search(text) else "direction",
                        "speaker": None, "text": inner})
            continue

        speaker = None
        if use_speakers:
            speaker, text = split_label(text)
            if speaker:
                # captions shout names inconsistently (CELL / Cell) — settle on Title
                speaker = speaker if speaker.istitle() else speaker.title()
                last_speaker = speaker
            else:
                speaker = last_speaker
        if text:
            out.append({"start": start, "end": end, "kind": "dialog",
                        "speaker": speaker, "text": text})

    for i, l in enumerate(out):
        l["i"] = i
    return [{"i": l["i"], "start": round(l["start"], 2), "end": round(l["end"], 2),
             "kind": l["kind"], "speaker": l["speaker"], "text": l["text"]} for l in out]


def pick_vtt(stage: Path, vid: str) -> Path | None:
    """Prefer the plain `.en` track; auto-translated variants are derivatives."""
    for cand in (f"{vid}.en.vtt", f"{vid}.en-orig.vtt"):
        p = stage / cand
        if p.exists():
            return p
    rest = sorted(stage.glob(f"{vid}.en*.vtt"))
    return rest[0] if rest else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", required=True)
    ap.add_argument("--kind", required=True)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--start-number", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    prefix = PREFIX.get(a.kind)
    if not prefix:
        sys.exit(f"no id prefix registered for kind {a.kind!r} — add one to PREFIX")

    infos = sorted(a.dir.glob("*.info.json"))
    if not infos:
        sys.exit(f"no *.info.json in {a.dir}")

    rows, skipped = [], []
    for ij in infos:
        info = json.loads(ij.read_text())
        vid = info.get("id")
        if not vid or not isinstance(info.get("duration"), (int, float)):
            continue                                   # playlist metadata, not a video
        if not has_human_captions(info):
            skipped.append((vid, "auto-generated captions only"))
            continue
        vtt = pick_vtt(a.dir, vid)
        if not vtt:
            skipped.append((vid, "no english captions"))
            continue
        raw = vtt.read_text(encoding="utf-8", errors="replace")
        if is_auto(raw):
            skipped.append((vid, "auto-generated captions"))
            continue
        lines = to_lines(parse_cues(raw))
        if not lines:
            skipped.append((vid, "no usable cues"))
            continue
        rows.append({"info": info, "lines": lines})

    rows.sort(key=lambda r: (r["info"].get("upload_date") or "", r["info"]["id"]))

    for n, r in enumerate(rows, start=a.start_number):
        info, lines = r["info"], r["lines"]
        item = f"{prefix}{n:02d}"
        title = clean_title(info.get("title", "")) or item
        media = {
            "id": item, "show": a.show, "kind": a.kind, "number": n, "title": title,
            "youtube": info["id"], "duration": int(round(info["duration"])),
            "upload_date": str(info.get("upload_date") or ""), "captions": ["en"],
        }
        transcript = {
            "item": item, "show": a.show, "youtube": info["id"], "title": title,
            "duration": int(round(info["duration"])), "lines": lines, "segments": [],
        }
        spk = len({l["speaker"] for l in lines if l["speaker"]})
        print(f"  {item}  {len(lines):4} lines  {spk:2} speakers  {title}")
        if a.dry_run:
            continue
        mp = CONTENT / "media" / a.show / f"{item}.yaml"
        tp = CONTENT / "transcripts" / a.show / f"{item}.json"
        mp.parent.mkdir(parents=True, exist_ok=True)
        tp.parent.mkdir(parents=True, exist_ok=True)
        mp.write_text(yaml.safe_dump(media, sort_keys=False, allow_unicode=True))
        tp.write_text(json.dumps(transcript, ensure_ascii=False))

    for vid, why in skipped:
        print(f"  SKIP {vid}: {why}")
    print(f"{'(dry run) ' if a.dry_run else ''}{len(rows)} written, {len(skipped)} skipped")


if __name__ == "__main__":
    main()
