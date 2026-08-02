// Frame store: 640w WebP every 0.5s per item, served straight from R2 (no functions).
// Frame n covers t=(n-1)*0.5 — see tools/rip_frames.py.
export const FRAMES = "https://dbza-frames.bool.is";

export function frameN(t) {
  return Math.max(1, Math.round(t * 2) + 1);
}

export function frameUrl(item, t) {
  // ?c partitions the edge cache: every in-app request carries an Origin header
  // (crossorigin imgs / canvas), so these entries always cache WITH
  // Access-Control-Allow-Origin. Origin-less fetches of the same frame (OG
  // crawlers, direct hits) use the bare URL and can't poison canvas loads.
  return `${FRAMES}/${item}/grid/${String(frameN(t)).padStart(6, "0")}.webp?c`;
}

/** Frame time for a transcript line: override if set, else the line's midpoint. */
export function lineFrameT(line, i, overrides) {
  const ov = overrides?.[i];
  return typeof ov === "number" ? ov : (line[0] + line[1]) / 2;
}
