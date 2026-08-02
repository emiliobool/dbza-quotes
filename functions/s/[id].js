// Saved-clip permalinks: /s/{id} → 302 to the canonical stateful /c/ URL.
// Crawlers follow the redirect, so the /c/ OG function handles the unfurl
// (quote text + the card uploaded at save time). The mapping is immutable,
// so the redirect can cache hard.
export async function onRequestGet({ params, request, env }) {
  const id = params.id;
  const home = new URL("/", request.url).href;
  if (!env.DB || !/^[a-z0-9]{4,16}$/.test(id ?? ""))
    return new Response(null, { status: 302, headers: { location: home } });
  const row = await env.DB.prepare(
    "SELECT show, item, query FROM saved_clips WHERE id = ?"
  ).bind(id).first();
  if (!row) return new Response(null, { status: 302, headers: { location: home } });
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(`/c/${row.show}/${row.item}/?${row.query}`, request.url).href,
      "cache-control": "public, max-age=86400",
    },
  });
}
