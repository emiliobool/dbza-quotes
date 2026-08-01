// Admin/agent: annotate a submission. POST /api/queue/{id} {action: approve|reject, note?}
// Approve ≠ publish — publishing is always a commit to content/. This only marks the queue.
import { requireAuth, json } from "./_lib.js";

export async function onRequestPost({ request, env, params }) {
  const denied = requireAuth(request, env);
  if (denied) return denied;

  const id = parseInt(params.id, 10);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const { action, note } = body ?? {};
  if (!Number.isFinite(id) || !["approve", "reject"].includes(action))
    return json({ error: "bad request" }, 400);

  const status = action === "approve" ? "approved" : "rejected";
  const r = await env.DB.prepare(
    "UPDATE submissions SET status = ?, note = COALESCE(?, note) WHERE id = ?"
  ).bind(status, note ?? null, id).run();
  if (!r.meta.changes) return json({ error: "not found" }, 404);
  return json({ ok: true, id, status });
}
