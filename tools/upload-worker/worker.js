// Temporary bulk uploader: POST /batch (multipart form, part name = object key).
// Auth: Bearer UPLOAD_TOKEN (worker secret). Delete this worker after the load.
export default {
  async fetch(request, env) {
    const auth = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!env.UPLOAD_TOKEN || auth !== env.UPLOAD_TOKEN)
      return new Response("unauthorized", { status: 401 });

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/batch") {
      const form = await request.formData();
      let n = 0;
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") continue;
        await env.BUCKET.put(key, value.stream(), {
          httpMetadata: {
            contentType: "image/webp",
            cacheControl: "public, max-age=31536000, immutable",
          },
        });
        n++;
      }
      return Response.json({ ok: true, uploaded: n });
    }
    if (request.method === "GET" && url.pathname === "/count") {
      // spot check: list one page under a prefix
      const l = await env.BUCKET.list({ prefix: url.searchParams.get("prefix") ?? "", limit: 5 });
      return Response.json({ sample: l.objects.map((o) => o.key), truncated: l.truncated });
    }
    return new Response("not found", { status: 404 });
  },
};
