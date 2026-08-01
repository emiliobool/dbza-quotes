#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pyyaml"]
# ///
"""One-time (re-runnable) migration from dba-video-clips into this content repo.

Reads cleaned canonical transcripts + reddit-matched default clips from
../dba-video-clips/data/canonical-clean and writes:

  content/shows/dbza.yaml
  content/media/dbza/{item}.yaml        e01..e69, m01..m12 (stable ids)
  content/transcripts/dbza/{item}.json  cleaned lines + agent segments
  content/clips/dbza/{slug}.yaml        seed catalog from reddit matching
    status: published  — match corroborated by an agent-proposed segment
    status: draft      — matched line only (bounds are a guess; review)
"""

import json
import re
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).parent.parent
SRC = ROOT.parent / "dba-video-clips" / "data" / "canonical-clean"
CONTENT = ROOT / "content"

TITLE_NOISE = [
    re.compile(r"^Dragon\s?Ball Z Abridged(?: Movie)?:\s*", re.IGNORECASE),
    re.compile(r"^DBZ Kai Abridged.*?:\s*", re.IGNORECASE),
    re.compile(r"\s*[|-]\s*Team\s?Four\s?Star(\s*\(TFS\)|\s*#\w+)?\s*$", re.IGNORECASE),
    re.compile(r"\s*-?\s*#(CellGames|DBZA\d+|TFS\w+)\s*$", re.IGNORECASE),
    re.compile(r"\s*#\s*$"),
]


def clean_title(t: str) -> str:
    for p in TITLE_NOISE:
        t = p.sub("", t)
    return t.strip()


def slugify(s: str, max_len: int = 48) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0]
    return s or "clip"


def dump_yaml(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )


def main():
    today = date.today().isoformat()

    dump_yaml(CONTENT / "shows" / "dbza.yaml", {
        "id": "dbza",
        "title": "Dragon Ball Z Abridged",
        "aliases": ["dba", "dbza", "tfs"],
        "language": "en",
        "visibility": "public",
        "sources": [
            {"kind": "youtube_playlist", "playlist": "PL6EC7B047181AD013", "label": "Episodes"},
            {"kind": "youtube_playlist", "playlist": "PL5j80D9V7lqb69YBC9aNjQeQcpH7Ps11y", "label": "Movies"},
        ],
    })

    # media + transcripts
    vid_to_item = {}
    for cat, prefix, kind in (("episodes", "e", "episode"), ("movies", "m", "movie")):
        for f in sorted((SRC / cat).glob("*.json")):
            d = json.loads(f.read_text())
            item = f"{prefix}{d['playlist_index']:02d}"
            vid_to_item[d["video_id"]] = item
            dump_yaml(CONTENT / "media" / "dbza" / f"{item}.yaml", {
                "id": item,
                "show": "dbza",
                "kind": kind,
                "number": d["playlist_index"],
                "title": clean_title(d.get("title") or item),
                "youtube": d["video_id"],
                "duration": d.get("duration"),
                "upload_date": d.get("upload_date"),
                "captions": ["en"],
            })
            tpath = CONTENT / "transcripts" / "dbza" / f"{item}.json"
            tpath.parent.mkdir(parents=True, exist_ok=True)
            tpath.write_text(json.dumps({
                "item": item,
                "show": "dbza",
                "youtube": d["video_id"],
                "title": clean_title(d.get("title") or item),
                "duration": d.get("duration"),
                "lines": d["lines"],
                "segments": d.get("segments", []),
            }, ensure_ascii=False, indent=1), encoding="utf-8")

    # seed clips from reddit matching
    matched = json.loads((SRC / "default_clips.json").read_text())["matched"]
    used = set()
    published = drafts = 0
    tcache = {}
    for r in matched:
        item = vid_to_item[r["video_id"]]
        # main quote = the matched transcript line (clip start/end is the context window)
        if item not in tcache:
            tcache[item] = json.loads((CONTENT / "transcripts" / "dbza" / f"{item}.json").read_text())
        qline = tcache[item]["lines"][r["line_i"]] if r.get("line_i") is not None else None
        base = slugify(r["segment"] or r["quote"])
        slug = base
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        corroborated = r["segment"] is not None
        published += corroborated
        drafts += not corroborated
        dump_yaml(CONTENT / "clips" / "dbza" / f"{slug}.yaml", {
            "id": slug,
            "show": "dbza",
            "media": item,
            "start": r["clip_start"],
            "end": r["clip_end"],
            "title": r["segment"] or r["quote"][:80],
            "quote": r["quote"],
            "quote_start": qline["start"] if qline else None,
            "quote_end": qline["end"] if qline else None,
            "speaker": r["speaker"],
            "tags": [slugify(r["speaker"])] if r["speaker"] else [],
            "status": "published" if corroborated else "draft",
            "source": r.get("source"),
            "signal": r.get("score_signal"),
            "recurrence": r.get("recurrence"),
            "added": today,
            "by": "reddit-pipeline",
        })

    print(f"media: {len(vid_to_item)}, clips: {published} published + {drafts} draft")


if __name__ == "__main__":
    main()
