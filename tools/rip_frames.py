#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pyyaml", "pillow"]
# ///
"""Rip a 640w frame every 0.5s for every video → frames-store/{item}/grid/{n}.webp.

This grid is the ONLY frame store: a transcript line's image is the grid frame
nearest its (possibly overridden) timestamp — frame n covers t=(n-1)*0.5, so
t → n = round(t*2)+1. Streams to keep disk use low: download one video (≤720p,
video-only) → extract → delete → next. Output is uploaded to R2, never committed.

Usage:
  tools/rip_frames.py            # full corpus, skips completed items
  tools/rip_frames.py e01 m08    # specific items
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
YT_FORMAT = "bv*[height<=720][ext=mp4]/bv*[height<=720]/22/best"
WIDTH, QUALITY = 640, 72


def sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def download(youtube, dest):
    r = sh(["yt-dlp", "-f", YT_FORMAT, "--no-update", "-o", str(dest),
            f"https://youtu.be/{youtube}"], timeout=1800)
    if r.returncode != 0 or not dest.exists():
        alts = list(dest.parent.glob(dest.stem + ".*"))
        return alts[0] if alts else None
    return dest


def extract_grid(video, out_dir):
    """Every 0.5s in a single pass: ffmpeg → jpg, PIL → webp."""
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / "_raw"
    raw.mkdir(exist_ok=True)
    r = sh(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
            "-vf", f"fps=2,scale={WIDTH}:-2", "-q:v", "4", str(raw / "%06d.jpg")],
           timeout=3600)
    if r.returncode != 0:
        shutil.rmtree(raw, ignore_errors=True)
        return False
    for j in raw.glob("*.jpg"):
        Image.open(j).convert("RGB").save(out_dir / (j.stem + ".webp"), "WEBP", quality=QUALITY)
        j.unlink()
    raw.rmdir()
    return True


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{u}"
        n /= 1024
    return f"{n:.1f}TB"


def main():
    items_arg = [a for a in sys.argv[1:] if not a.startswith("-")]
    media = {}
    for f in sorted((ROOT / "content" / "media" / SHOW).glob("*.yaml")):
        m = yaml.safe_load(f.read_text())
        media[m["id"]] = m

    total_bytes = total_frames = 0
    for item in (items_arg or sorted(media.keys())):
        m = media[item]
        grid_dir = STORE / item / "grid"
        expected = int((m.get("duration") or 0) * 2)
        existing = list(grid_dir.glob("*.webp")) if grid_dir.exists() else []
        if expected and len(existing) >= expected - 4:
            print(f"{item}: done ({len(existing)} frames)")
            total_frames += len(existing)
            total_bytes += sum(f.stat().st_size for f in existing)
            continue

        TMP.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        video = download(m["youtube"], TMP / f"{item}.mp4")
        if not video:
            print(f"{item}: download FAILED")
            continue
        ok = extract_grid(video, grid_dir)
        video.unlink(missing_ok=True)
        frames = list(grid_dir.glob("*.webp"))
        size = sum(f.stat().st_size for f in frames)
        total_frames += len(frames)
        total_bytes += size
        print(f"{item}: {'ok' if ok else 'FAILED'} {len(frames)} frames {human(size)} "
              f"({human(size/max(1,len(frames)))}/ea) in {time.time()-t0:.0f}s")

    shutil.rmtree(TMP, ignore_errors=True)
    print(f"\ntotal: {total_frames} frames, {human(total_bytes)}")


if __name__ == "__main__":
    main()
