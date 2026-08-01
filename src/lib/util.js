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

export function clipUrl(show, item, start, end) {
  const t = Math.round(start * 10) / 10;
  const d = Math.round((end - start) * 10) / 10;
  return `/c/${show}/${item}/?t=${t}&d=${d}`;
}
