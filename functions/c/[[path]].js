// OG-tag injection for ad-hoc clip links: /c/{show}/{item}/?t=273.4&d=9.7
// Serves the prerendered static shell with og:title/description rewritten to
// the actual quote, and og:image pointing at the browser-uploaded card for
// this exact URL state (see /api/og-card) — falling back to the first selected
// line's frame. Fully optional: if this function is down, the static shell
// still renders.
import { ogCardKey, frameImgUrl } from "../_lib/og.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const [, , show, item] = url.pathname.split("/");
  const t = parseFloat(url.searchParams.get("t"));
  const d = parseFloat(url.searchParams.get("d") ?? "15");

  const shell = await env.ASSETS.fetch(new URL(url.pathname, url.origin));
  if (!show || !item || !Number.isFinite(t)) return shell;

  // quantize to 0.5s so the cacheable URL space is finite
  const qt = Math.round(t * 2) / 2;
  const qd = Math.min(120, Math.max(1, Math.round(d * 2) / 2));

  // the card key folds in everything the image depends on (qs/qe/f/cols/txt),
  // so it belongs in the cache key too
  const key = await ogCardKey(show, item, url.searchParams);

  // deploy sha in the key so a new deploy never serves last week's shell
  const v = env.CF_PAGES_COMMIT_SHA ?? "dev";
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}?t=${qt}&d=${qd}&k=${key ?? "0"}&__v=${v}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // qs/qe is the actual quote selection; t/d is the playback window, whose
  // lead-in padding can sweep in the line before the quote
  const pqs = parseFloat(url.searchParams.get("qs"));
  const pqe = parseFloat(url.searchParams.get("qe"));
  const qsT = Number.isFinite(pqs) ? pqs : qt;
  const qeT = Number.isFinite(pqe) ? pqe : qt + qd;

  let quote = "";
  let data = null;
  try {
    const tr = await env.ASSETS.fetch(new URL(`/data/transcripts/${show}/${item}.json`, url.origin));
    if (tr.ok) {
      data = await tr.json();
      // sparse selection (?sel= line indices) unfurls only the picked lines
      const selI = (url.searchParams.get("sel") ?? "")
        .split(",").map((v) => parseInt(v, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < data.lines.length);
      quote = (selI.length
        ? selI.map((i) => data.lines[i])
        : data.lines.filter((l) => l[1] > qsT && l[0] < qeT))
        .filter((l) => l[2] === "dialog")
        .map((l) => (l[3] ? `${l[3]}: ${l[4]}` : l[4]))
        .join(" ")
        .slice(0, 300);
    }
  } catch {}

  if (!quote) return shell;

  // og:image — the uploaded card for this state, else the first selected
  // line's frame. A missing card gets a short edge TTL: the uploader may
  // simply not have finished before the first crawler arrived.
  let ogImg = null;
  let ttl = 604800;
  if (key && env.FRAMES && (await env.FRAMES.head(key).catch(() => null))) {
    ogImg = `https://dbza-frames.bool.is/${key}`;
  } else {
    if (key) ttl = 300;
    const fv = parseFloat((url.searchParams.get("f") ?? "").split(",")[0]);
    let ft = Number.isFinite(fv) ? fv : null;
    if (ft === null && data) {
      const i = data.lines.findIndex((l) => l[1] > qsT && l[0] < qeT);
      if (i >= 0) {
        const ov = data.overrides?.[i];
        ft = typeof ov === "number" ? ov : (data.lines[i][0] + data.lines[i][1]) / 2;
      }
    }
    if (ft !== null) ogImg = frameImgUrl(item, ft);
  }

  const setContent = (value) => ({
    element(el) { el.setAttribute("content", value); },
  });
  let rw = new HTMLRewriter()
    .on('meta[property="og:title"]', setContent(quote.length > 70 ? quote.slice(0, 67) + "…" : quote))
    .on('meta[property="og:description"]', setContent(quote))
    .on('meta[name="description"]', setContent(quote));
  if (ogImg) rw = rw.on('meta[property="og:image"]', setContent(ogImg));
  const rewritten = rw.transform(shell);

  const resp = new Response(rewritten.body, rewritten);
  // edge caches per-deploy (see cacheKey); browsers must always revalidate
  resp.headers.set("cache-control", `public, max-age=0, must-revalidate, s-maxage=${ttl}`);
  await cache.put(cacheKey, resp.clone());
  return resp;
}
