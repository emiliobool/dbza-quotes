// Receives the browser-rendered quote card (canvas → JPEG) and stores it in
// the frames bucket, so a shared /c/ link can unfurl with the exact image the
// page renders. The key is derived server-side from the URL state; first write
// wins, so an already-shared link's card can't be repainted by anyone else.
import { ogCardKey } from "../_lib/og.js";

export async function onRequestPost({ request, env }) {
  if (!env.FRAMES) return new Response("no bucket", { status: 503 });
  const p = new URL(request.url).searchParams;
  const key = await ogCardKey(p.get("show"), p.get("item"), p);
  if (!key) return new Response("bad params", { status: 400 });
  if (await env.FRAMES.head(key)) return Response.json({ ok: true, exists: true });

  const buf = await request.arrayBuffer();
  const b = new Uint8Array(buf);
  if (buf.byteLength < 100 || buf.byteLength > 4_000_000 || b[0] !== 0xff || b[1] !== 0xd8)
    return new Response("expected a jpeg under 4MB", { status: 415 });

  await env.FRAMES.put(key, buf, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
  });
  return Response.json({ ok: true });
}
