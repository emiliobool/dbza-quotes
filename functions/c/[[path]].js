// OG-tag injection for ad-hoc clip links: /c/{show}/{item}/?t=273.4&d=9.7
// Serves the prerendered static shell with og:title/description rewritten to the
// actual quote at that timestamp, so Discord/Twitter unfurls show the dialog.
// Fully optional: if this function is down, the static shell still renders.

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

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}?t=${qt}&d=${qd}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let quote = "";
  try {
    const tr = await env.ASSETS.fetch(new URL(`/data/transcripts/${show}/${item}.json`, url.origin));
    if (tr.ok) {
      const data = await tr.json();
      quote = data.lines
        .filter((l) => l[2] === "dialog" && l[1] > qt && l[0] < qt + qd)
        .map((l) => (l[3] ? `${l[3]}: ${l[4]}` : l[4]))
        .join(" ")
        .slice(0, 300);
    }
  } catch {}

  if (!quote) return shell;

  const setContent = (value) => ({
    element(el) { el.setAttribute("content", value); },
  });
  const rewritten = new HTMLRewriter()
    .on('meta[property="og:title"]', setContent(quote.length > 70 ? quote.slice(0, 67) + "…" : quote))
    .on('meta[property="og:description"]', setContent(quote))
    .on('meta[name="description"]', setContent(quote))
    .transform(shell);

  const resp = new Response(rewritten.body, rewritten);
  resp.headers.set("cache-control", "public, s-maxage=604800");
  await cache.put(cacheKey, resp.clone());
  return resp;
}
