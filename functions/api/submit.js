// Public submission endpoint → D1 queue. Moderated-by-default: nothing here
// publishes anything; approval + publishing happen via git in the content repo.
const KINDS = new Set(["clip_suggestion", "show_request", "correction", "gif_link"]);
const MAX_BODY = 4096;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "submissions not configured" }, 503);

  const len = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY) return json({ error: "too large" }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const { kind, payload, turnstileToken } = body ?? {};
  if (!KINDS.has(kind) || typeof payload !== "object" || payload === null)
    return json({ error: "bad request" }, 400);

  const ip = request.headers.get("cf-connecting-ip") ?? "";

  // Turnstile — enforced when configured
  if (env.TURNSTILE_SECRET) {
    const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: turnstileToken ?? "", remoteip: ip }),
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!v.success) return json({ error: "verification failed" }, 403);
  }

  const payloadStr = JSON.stringify(payload).slice(0, MAX_BODY);
  const ipHash = await sha256(ip + (env.IP_SALT ?? ""));

  // cheap dedupe: identical payload from same ip in last day
  const dupe = await env.DB.prepare(
    "SELECT id FROM submissions WHERE ip_hash = ? AND payload = ? AND created_at > datetime('now','-1 day') LIMIT 1"
  ).bind(ipHash, payloadStr).first();
  if (dupe) return json({ ok: true, deduped: true });

  // circuit breaker: close the queue if flooded
  const { c } = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM submissions WHERE created_at > datetime('now','-1 day')"
  ).first();
  if (c >= (parseInt(env.MAX_DAILY ?? "500", 10))) return json({ error: "queue is full, try tomorrow" }, 429);

  await env.DB.prepare(
    "INSERT INTO submissions (kind, payload, ip_hash) VALUES (?, ?, ?)"
  ).bind(kind, payloadStr, ipHash).run();
  return json({ ok: true });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
