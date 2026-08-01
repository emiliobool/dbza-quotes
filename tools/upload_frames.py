#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["requests"]
# ///
"""Bulk-upload frames-store/ to the dbza-frames bucket via the uploader worker.

Object keys mirror the local layout: {item}/{kind}/{name}.webp
Resumable: keeps a local manifest of uploaded keys and skips them on re-run.

Env: UPLOAD_URL (worker base), UPLOAD_TOKEN.
"""

import concurrent.futures as cf
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
STORE = ROOT / "frames-store"
MANIFEST = STORE / ".uploaded.txt"
BATCH = 40
WORKERS = 5

URL = os.environ.get("UPLOAD_URL", "").rstrip("/")
TOKEN = os.environ.get("UPLOAD_TOKEN", "")
if not URL or not TOKEN:
    sys.exit("set UPLOAD_URL and UPLOAD_TOKEN")

done = set(MANIFEST.read_text().split()) if MANIFEST.exists() else set()
files = []
for p in sorted(STORE.rglob("*.webp")):
    key = str(p.relative_to(STORE))
    if key not in done:
        files.append((key, p))
print(f"{len(files)} to upload ({len(done)} already done)")

lock_write = MANIFEST.open("a")


def send(batch):
    parts = [(key, (key, p.read_bytes(), "image/webp")) for key, p in batch]
    for attempt in range(4):
        try:
            r = requests.post(f"{URL}/batch", files=parts,
                              headers={"authorization": f"Bearer {TOKEN}"}, timeout=120)
            if r.ok:
                return [k for k, _ in batch]
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    return []


batches = [files[i:i + BATCH] for i in range(0, len(files), BATCH)]
uploaded = 0
t0 = time.time()
with cf.ThreadPoolExecutor(WORKERS) as ex:
    for keys in ex.map(send, batches):
        for k in keys:
            lock_write.write(k + "\n")
        lock_write.flush()
        uploaded += len(keys)
        if uploaded and uploaded % 2000 < BATCH:
            rate = uploaded / (time.time() - t0)
            print(f"{uploaded}/{len(files)} ({rate:.0f}/s, eta {(len(files)-uploaded)/max(rate,1)/60:.0f}m)")

print(f"done: {uploaded} uploaded in {(time.time()-t0)/60:.1f}m")
