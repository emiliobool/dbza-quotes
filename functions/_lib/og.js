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

/** Validated, normalized image state from a share URL's params, or null. */
export function canonState(show, item, params) {
  if (!/^[a-z0-9-]{1,40}$/.test(show ?? "") || !/^[a-z0-9-]{1,40}$/.test(item ?? "")) return null;
  const qs = parseFloat(params.get("qs"));
  const qe = parseFloat(params.get("qe"));
  if (!Number.isFinite(qs) || !Number.isFinite(qe)) return null;
  const f = (params.get("f") ?? "")
    .split(",").map((v) => parseFloat(v)).filter(Number.isFinite).map(r).join(",");
  const cols = ["2", "3"].includes(params.get("cols")) ? params.get("cols") : "";
  const txt = (params.get("txt") ?? "").slice(0, 300);
  // caption placement, one "t"/"b" per selected line (absent = all bottom)
  const cap = /^[tb]{1,40}$/.test(params.get("cap") ?? "") ? params.get("cap") : "";
  // sparse selection: indices of the picked lines (absent = contiguous)
  const sel = (params.get("sel") ?? "")
    .split(",").map((v) => parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 100000)
    .slice(0, 40).join(",");
  return { show, item, qs: r(qs), qe: r(qe), f, cols, txt, sel, cap };
}

async function sha256hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** R2 key for a share URL's rendered card, or null if the state can't have one. */
export async function ogCardKey(show, item, params) {
  const c = canonState(show, item, params);
  if (!c) return null;
  // sel/cap appended only when present, so keys for URLs without them never change
  const parts = [c.show, c.item, c.qs, c.qe, c.f, c.cols, c.txt];
  if (c.sel) parts.push(c.sel);
  if (c.cap) parts.push(`cap:${c.cap}`);
  const hex = await sha256hex(parts.join("|"));
  return `og/${hex.slice(0, 40)}.jpg`;
}

/** Short content-addressed id for a saved clip: same state → same id, always. */
export async function savedId(show, item, query, len = 8) {
  const hex = await sha256hex(`${show}/${item}?${query}`);
  return BigInt(`0x${hex.slice(0, 24)}`).toString(36).padStart(len, "0").slice(0, len);
}
