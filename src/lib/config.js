// Frame store: 640w WebP every 0.5s per item, served straight from R2 (no functions).
// Frame n covers t=(n-1)*0.5 — see tools/rip_frames.py.
export const FRAMES = "https://dbza-frames.bool.is";

export function frameN(t) {
  return Math.max(1, Math.round(t * 2) + 1);
}

const framePath = (item, t) =>
  `${FRAMES}/${item}/grid/${String(frameN(t)).padStart(6, "0")}.webp`;

/** For loads that send an Origin: crossorigin <img> and anything the canvas
 *  reads. The query partitions the cache so only CORS-bearing responses land
 *  here — a cached response without Access-Control-Allow-Origin would fail
 *  every canvas load that reuses the entry. Anything that cannot send an
 *  Origin must use framePlainUrl instead. Bumped c → c2 to abandon entries
 *  poisoned before the CSS poster and cmdk thumbnails were split off. */
export function frameUrl(item, t) {
  return `${framePath(item, t)}?c2`;
}

/** For loads that CANNOT send an Origin — CSS background-image, OG crawlers,
 *  direct hits. Bare URL, so they populate a separate cache entry. */
export function framePlainUrl(item, t) {
  return framePath(item, t);
}

/** Frame time for a transcript line: override if set, else the line's midpoint. */
export function lineFrameT(line, i, overrides) {
  const ov = overrides?.[i];
  return typeof ov === "number" ? ov : (line[0] + line[1]) / 2;
}
