// Save = publish: mints a public permalink (/s/{id}) for the current quote
// state and stores its rendered card (JPEG body) for OG unfurls. Content-
// addressed and immutable — the id is a hash of the state, so saving the same
// quote twice is a no-op and "editing" a saved clip just means saving a new
// variant. Nothing here can overwrite what anyone already shared.
import { canonState, ogCardKey, savedId } from "../_lib/og.js";

const r = (x) => Math.round(x * 10) / 10;

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.FRAMES) return json({ error: "saving not configured" }, 503);
  const p = new URL(request.url).searchParams;
  const c = canonState(p.get("show"), p.get("item"), p);
  const t = parseFloat(p.get("t"));
  const d = parseFloat(p.get("d"));
  if (!c || !Number.isFinite(t) || !Number.isFinite(d)) return json({ error: "bad params" }, 400);

  // canonical query — rebuilt from validated fields, never stored verbatim
  const q = new URLSearchParams();
  q.set("t", r(Math.max(0, t)));
  q.set("d", r(Math.min(600, Math.max(0.5, d))));
  q.set("qs", c.qs);
  q.set("qe", c.qe);
  if (c.f) q.set("f", c.f);
  if (c.cols) q.set("cols", c.cols);
  if (c.txt) q.set("txt", c.txt);
  const query = q.toString();

  // 8 chars ≈ 41 bits — plenty here, but on the off chance two different
  // states collide, fall back to the 12-char id instead of lying
  let id = await savedId(c.show, c.item, query);
  let row = await env.DB.prepare("SELECT query FROM saved_clips WHERE id = ?").bind(id).first();
  if (row && row.query !== query) {
    id = await savedId(c.show, c.item, query, 12);
    row = await env.DB.prepare("SELECT query FROM saved_clips WHERE id = ?").bind(id).first();
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ipHash = await sha256(ip + (env.IP_SALT ?? ""));
  if (!row) {
    const mine = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM saved_clips WHERE ip_hash = ? AND created_at > datetime('now','-1 day')"
    ).bind(ipHash).first();
    if (mine.c >= 100) return json({ error: "that's a lot of saving — try tomorrow" }, 429);
    const all = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM saved_clips WHERE created_at > datetime('now','-1 day')"
    ).first();
    if (all.c >= parseInt(env.MAX_DAILY_SAVES ?? "2000", 10))
      return json({ error: "save queue is full, try tomorrow" }, 429);
  }

  // the card rides along in the body; first write wins, same as /api/og-card
  const cardKey = await ogCardKey(c.show, c.item, p);
  const buf = await request.arrayBuffer();
  const b = new Uint8Array(buf);
  const jpegOk = buf.byteLength >= 100 && buf.byteLength <= 4_000_000 && b[0] === 0xff && b[1] === 0xd8;
  if (jpegOk && cardKey && !(await env.FRAMES.head(cardKey).catch(() => null)))
    await env.FRAMES.put(cardKey, buf, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });

  if (!row)
    await env.DB.prepare(
      "INSERT OR IGNORE INTO saved_clips (id, show, item, query, ip_hash) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, c.show, c.item, query, ipHash).run();

  // The saver's own page view already edge-cached a "no card yet" unfurl for
  // this URL (300s TTL). Purge it — best-effort and per-colo, but the saver's
  // colo is exactly where their next share gets crawled from most often.
  // Reconstructs the cache key of functions/c/[[path]].js verbatim.
  try {
    const origin = new URL(request.url).origin;
    const qt = Math.round(t * 2) / 2;
    const qd = Math.min(120, Math.max(1, Math.round(d * 2) / 2));
    const v = env.CF_PAGES_COMMIT_SHA ?? "dev";
    await caches.default.delete(
      new Request(`${origin}/c/${c.show}/${c.item}/?t=${qt}&d=${qd}&k=${cardKey}&__v=${v}`)
    );
  } catch {}

  return json({ ok: true, id, url: `/s/${id}`, existing: !!row });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
