// Shared by /api/og-card (write) and /c/[[path]] (read): both must derive the
// exact same R2 key from a share URL's image state, or uploaded cards would
// never be found again. Canonicalization mirrors currentUrl() in quotenav.js:
// times rounded to 0.1s, txt capped at 300 chars, cols only ever "2"/"3".
const r = (x) => Math.round(x * 10) / 10;

// duplicated from src/lib/config.js so functions stay self-contained
export function frameImgUrl(item, t) {
  const n = Math.max(1, Math.round(t * 2) + 1);
  return `https://dbza-frames.bool.is/${item}/grid/${String(n).padStart(6, "0")}.webp`;
}

/** R2 key for a share URL's rendered card, or null if the state can't have one. */
export async function ogCardKey(show, item, params) {
  if (!/^[a-z0-9-]{1,40}$/.test(show ?? "") || !/^[a-z0-9-]{1,40}$/.test(item ?? "")) return null;
  const qs = parseFloat(params.get("qs"));
  const qe = parseFloat(params.get("qe"));
  if (!Number.isFinite(qs) || !Number.isFinite(qe)) return null;
  const f = (params.get("f") ?? "")
    .split(",").map((v) => parseFloat(v)).filter(Number.isFinite).map(r).join(",");
  const cols = ["2", "3"].includes(params.get("cols")) ? params.get("cols") : "";
  const txt = (params.get("txt") ?? "").slice(0, 300);
  const canon = [show, item, r(qs), r(qe), f, cols, txt].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `og/${hex.slice(0, 40)}.jpg`;
}
