// /random → 302 to a random dialog line's quote page. The episode pick is
// weighted by duration so a line in a 25-minute episode is roughly as likely
// as a line in a 40-second short.
export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const home = () => new Response(null, { status: 302, headers: { location: `${origin}/` } });
  try {
    const media = await (await env.ASSETS.fetch(new URL("/data/media.json", origin))).json();
    const items = Object.entries(media).flatMap(([show, m]) =>
      Object.entries(m).map(([item, v]) => ({ show, item, w: v.duration || 60 }))
    );
    if (!items.length) return home();
    let roll = Math.random() * items.reduce((a, x) => a + x.w, 0);
    let pick = items[items.length - 1];
    for (const x of items) { roll -= x.w; if (roll <= 0) { pick = x; break; } }

    const tr = await (
      await env.ASSETS.fetch(new URL(`/data/transcripts/${pick.show}/${pick.item}.json`, origin))
    ).json();
    const dialog = tr.lines.filter((l) => l[2] === "dialog");
    if (!dialog.length) return home();
    const line = dialog[Math.floor(Math.random() * dialog.length)];

    // mirror quotenav's share URLs: qs/qe span the line, t/d pads 1s in / 1.5s out
    const r = (x) => Math.round(x * 10) / 10;
    const qs = r(line[0]), qe = r(line[1]);
    const t = r(Math.max(0, qs - 1));
    const d = r(Math.min(tr.duration ?? qe + 1.5, qe + 1.5) - t);
    return new Response(null, {
      status: 302,
      headers: {
        location: `${origin}/c/${pick.show}/${pick.item}/?t=${t}&d=${d}&qs=${qs}&qe=${qe}`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return home();
  }
}
