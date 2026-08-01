#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pyyaml", "pillow"]
# ///
"""Render captioned quote frames for published clips → public/frames/{show}/.

For each published clip, extract a single video frame (yt-dlp resolves the
stream, ffmpeg seeks and grabs one frame) and burn the quote text on it,
subtitle-style. Output is committed static — this is the publish-time version
of the frame service.

Clip YAML may carry an `images:` list of variants:
    images:
      - id: default          # default → {slug}.jpg, else {slug}.{id}.jpg
        t: 24.5              # frame time (default: midpoint of matched quote line)
        text: "..."          # caption (default: verbatim transcript line at t)
When absent, one auto `default` variant is derived from the clip's quote.

Idempotent: existing outputs are skipped (use --force to re-render).
"""

import json
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
OUT_W = 1280
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]


def norm(s):
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split())


def best_quote_line(lines, start, end, quote):
    """Dialog line inside [start,end] most similar to the quote text."""
    nq = norm(quote)
    best, best_score = None, -1.0
    for l in lines:
        if l["kind"] != "dialog" or l["end"] <= start or l["start"] >= end:
            continue
        n = norm(l["text"])
        score = 0.99 if (len(nq) >= 10 and nq in n) else SequenceMatcher(None, nq, n).ratio()
        if score > best_score:
            best, best_score = l, score
    return best, best_score


def load_font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def caption(img, text):
    W, H = img.size
    draw = ImageDraw.Draw(img)
    size = max(28, W // 24)
    font = load_font(size)
    stroke = max(2, size // 14)
    max_w = W * 0.92

    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > 4:  # too long — shrink once, then clamp
        size = int(size * 0.8)
        font = load_font(size)
        stroke = max(2, size // 14)
        lines, cur = [], ""
        for w in words:
            trial = f"{cur} {w}".strip()
            if draw.textlength(trial, font=font) <= max_w:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        lines = lines[:5]

    line_h = size * 1.18
    y = H - len(lines) * line_h - H * 0.045
    for ln in lines:
        w = draw.textlength(ln, font=font)
        draw.text(((W - w) / 2, y), ln, font=font, fill="white",
                  stroke_width=stroke, stroke_fill="black")
        y += line_h
    return img


def resolve_stream(youtube):
    r = subprocess.run(
        ["yt-dlp", "-f", "22/best[height<=720][ext=mp4]/best", "-g", "--no-update",
         f"https://youtu.be/{youtube}"],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        print(f"  ! yt-dlp failed for {youtube}: {r.stderr.strip().splitlines()[-1] if r.stderr else '?'}")
        return None
    return r.stdout.strip().splitlines()[0]


def grab_frame(stream_url, t, out_png):
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", stream_url,
         "-frames:v", "1", "-q:v", "2", str(out_png)],
        capture_output=True, text=True, timeout=180,
    )
    return r.returncode == 0 and out_png.exists()


def main():
    force = "--force" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("-")]

    for show_dir in sorted((ROOT / "content" / "clips").iterdir()):
        show = show_dir.name
        out_dir = ROOT / "public" / "frames" / show
        out_dir.mkdir(parents=True, exist_ok=True)

        clips = []
        for f in sorted(show_dir.glob("*.yaml")):
            c = yaml.safe_load(f.read_text())
            if c.get("status") != "published":
                continue
            if only and c["id"] not in only:
                continue
            clips.append((f, c))

        # group by media so each stream URL resolves once
        by_media = {}
        for f, c in clips:
            by_media.setdefault(c["media"], []).append((f, c))

        done = failed = skipped = 0
        for media_id, group in sorted(by_media.items()):
            t_doc = json.loads(
                (ROOT / "content" / "transcripts" / show / f"{media_id}.json").read_text()
            )
            stream = None  # resolved lazily, only if some variant needs rendering

            for f, c in group:
                variants = c.get("images") or [{"id": "default"}]
                for v in variants:
                    vid = v.get("id", "default")
                    name = f"{c['id']}.jpg" if vid == "default" else f"{c['id']}.{vid}.jpg"
                    out = out_dir / name
                    if out.exists() and not force:
                        skipped += 1
                        continue

                    line, score = best_quote_line(t_doc["lines"], c["start"], c["end"], c["quote"])
                    t = v.get("t")
                    if t is None:
                        t = (line["start"] + line["end"]) / 2 if line and score > 0.4 \
                            else (c["start"] + c["end"]) / 2
                    text = v.get("text") or (line["text"] if line and score > 0.4 else c["quote"])

                    if stream is None:
                        stream = resolve_stream(t_doc["youtube"]) or "FAILED"
                    if stream == "FAILED":
                        failed += 1
                        continue

                    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
                        tmp_png = Path(tmp.name)
                        if not grab_frame(stream, t, tmp_png):
                            print(f"  ! frame grab failed: {c['id']} @ {t:.1f}s")
                            failed += 1
                            continue
                        img = Image.open(tmp_png).convert("RGB")
                        if img.width != OUT_W:
                            img = img.resize((OUT_W, round(img.height * OUT_W / img.width)))
                        caption(img, text)
                        img.save(out, "JPEG", quality=85)
                    done += 1
                    print(f"  {show}/{name}  @{t:.1f}s  \"{text[:60]}\"")

        print(f"{show}: {done} rendered, {skipped} existing, {failed} failed")


if __name__ == "__main__":
    main()
