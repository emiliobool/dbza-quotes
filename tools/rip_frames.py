#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pyyaml", "pillow"]
# ///
"""Rip per-line (and optionally per-0.5s) frames for whole episodes.

Streams to keep disk use low: download one video (≤720p mp4) → extract frames →
delete the video → next. Output (gitignored, NOT deployed to Pages):

  frames-store/{item}/line/{i}.webp    640w  — share/og size, one per dialog line (frame at line midpoint)
  frames-store/{item}/thumb/{i}.webp   320w  — transcript thumbnail, same timestamps
  frames-store/{item}/grid/{n}.webp    320w  — every 0.5s (only with --grid)

Usage:
  tools/rip_frames.py --sample e01 e50 m08   # measure sizes on a few videos (includes --grid)
  tools/rip_frames.py                        # full corpus, per-line only
  tools/rip_frames.py --grid                 # full corpus incl. 0.5s grid
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).parent.parent
STORE = ROOT / "frames-store"
TMP = STORE / "_tmp"
SHOW = "dbza"
# video-only stream (no audio needed) — muxed fallbacks last (18 is 360p!)
YT_FORMAT = "bv*[height<=720][ext=mp4]/bv*[height<=720]/22/best"


def sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def download(youtube, dest):
    r = sh(["yt-dlp", "-f", YT_FORMAT, "--no-update", "-o", str(dest),
            f"https://youtu.be/{youtube}"], timeout=1800)
    if r.returncode != 0 or not dest.exists():
        # yt-dlp may pick a non-mp4 container and change the extension
        alts = list(dest.parent.glob(dest.stem + ".*"))
        return alts[0] if alts else None
    return dest


def extract_at(video, t, outs):
    """Grab one frame at t (native res) and save each (path, width, quality) as webp."""
    png = video.parent / "_frame.png"
    r = sh(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video),
            "-frames:v", "1", str(png)], timeout=60)
    if r.returncode != 0 or not png.exists():
        return False
    img = Image.open(png).convert("RGB")
    for out, width, quality in outs:
        scaled = img.resize((width, round(img.height * width / img.width))) if img.width > width else img
        scaled.save(out, "WEBP", quality=quality)
    png.unlink(missing_ok=True)
    return True


def extract_grid(video, out_dir, width, quality):
    """Every 0.5s via a single pass: ffmpeg → jpgs, then PIL → webp."""
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / "_raw"
    raw.mkdir(exist_ok=True)
    r = sh(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
            "-vf", f"fps=2,scale={width}:-2", "-q:v", "5", str(raw / "%06d.jpg")], timeout=3600)
    if r.returncode != 0:
        return False
    for j in raw.glob("*.jpg"):
        Image.open(j).convert("RGB").save(out_dir / (j.stem + ".webp"), "WEBP", quality=quality)
        j.unlink()
    raw.rmdir()
    return True


def dir_stats(d, pattern="*.webp"):
    files = list(d.glob(pattern)) if d.exists() else []
    total = sum(f.stat().st_size for f in files)
    return len(files), total


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{u}"
        n /= 1024
    return f"{n:.1f}TB"


def process(item, youtube, lines, grid):
    out = STORE / item
    line_dir, thumb_dir = out / "line", out / "thumb"
    dialog = [l for l in lines if l["kind"] == "dialog"]
    if line_dir.exists() and len(list(line_dir.glob("*.webp"))) >= len(dialog):
        print(f"{item}: already done, skipping")
        return True

    TMP.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    video = download(youtube, TMP / f"{item}.mp4")
    if not video:
        print(f"{item}: download FAILED")
        return False
    dl = time.time() - t0

    line_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    ok = 0
    for l in dialog:
        mid = (l["start"] + l["end"]) / 2
        ok += extract_at(video, mid, [
            (line_dir / f"{l['i']}.webp", 640, 72),
            (thumb_dir / f"{l['i']}.webp", 320, 65),
        ])
    ex = time.time() - t0

    gmsg = ""
    if grid:
        t0 = time.time()
        extract_grid(video, out / "grid", 320, 65)
        gn, gs = dir_stats(out / "grid")
        gmsg = f", grid {gn} frames {human(gs)} in {time.time()-t0:.0f}s"

    video.unlink(missing_ok=True)
    ln, ls = dir_stats(line_dir)
    tn, ts = dir_stats(thumb_dir)
    print(f"{item}: {ok}/{len(dialog)} lines — 640w {human(ls)} ({human(ls/max(1,ln))}/ea), "
          f"320w {human(ts)} ({human(ts/max(1,tn))}/ea){gmsg} "
          f"[dl {dl:.0f}s, extract {ex:.0f}s]")
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    sample = "--sample" in sys.argv
    grid = "--grid" in sys.argv or sample

    media = {}
    for f in sorted((ROOT / "content" / "media" / SHOW).glob("*.yaml")):
        m = yaml.safe_load(f.read_text())
        media[m["id"]] = m

    items = args or sorted(media.keys())
    for item in items:
        t = json.loads((ROOT / "content" / "transcripts" / SHOW / f"{item}.json").read_text())
        process(item, media[item]["youtube"], t["lines"], grid)

    if sample:
        print("\n--- totals across sampled items ---")
        for kind in ("line", "thumb", "grid"):
            n = s = 0
            for item in items:
                a, b = dir_stats(STORE / item / kind)
                n += a; s += b
            if n:
                print(f"{kind}: {n} frames, {human(s)}, avg {human(s/n)}")
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
