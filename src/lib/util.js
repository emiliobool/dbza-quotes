// Shared helpers used both at build time (Astro frontmatter) and in client scripts.

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function ytThumb(youtube, quality = "hqdefault") {
  return `https://i.ytimg.com/vi/${youtube}/${quality}.jpg`;
}

export function ytLink(youtube, t) {
  return `https://youtu.be/${youtube}${t != null ? `?t=${Math.floor(t)}` : ""}`;
}

export function mediaLabel(m) {
  // titles are already self-describing ("Episode 15", "Christmas Tree of Might");
  // playlist position is NOT the episode number (specials interleave), so never prefix it
  return m ? m.title : "";
}

/** Canonical stateful /c/ URL for a curated clip record — the same notion a
 *  saved entry (/s/{id}) resolves to. There are no per-clip pages anymore. */
export function clipUrl(c) {
  const r = (x) => Math.round(x * 10) / 10;
  // qs/qe round INWARD: rounding outward can lasso an adjacent line that ends
  // exactly where the quote starts (line-picking uses overlap, not containment)
  const qs = Math.ceil((c.quote_start ?? c.start) * 10) / 10;
  const qe = Math.floor((c.quote_end ?? c.end) * 10) / 10;
  return `/c/${c.show}/${c.media}/?t=${r(c.start)}&d=${r(c.end - c.start)}&qs=${qs}&qe=${qe}`;
}
