// Admin/agent: list submissions. GET /api/queue?status=pending&kind=clip_suggestion
import { requireAuth, json } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const denied = requireAuth(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const kind = url.searchParams.get("kind");

  let q = "SELECT id, kind, payload, status, note, created_at FROM submissions WHERE status = ?";
  const binds = [status];
  if (kind) { q += " AND kind = ?"; binds.push(kind); }
  q += " ORDER BY id DESC LIMIT 200";

  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return json(results.map((r) => ({ ...r, payload: JSON.parse(r.payload) })));
}
