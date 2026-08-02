// Build step: validate content/ and emit the JSON the site consumes.
//   src/gen/site.json                     — shows, media, published+draft clips (build-time)
//   public/data/media.json                — media map for client islands
//   public/data/clips.json                — published clips for client islands
//   public/data/search/{show}.json        — dialog docs for MiniSearch
//   public/data/transcripts/{show}/{item}.json — compact lines for editor/OG
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT = join(ROOT, "content");
const PUB = join(ROOT, "public", "data");
const GEN = join(ROOT, "src", "gen");

const readYaml = (p) => YAML.parse(readFileSync(p, "utf8"));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, data) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data));
};

rmSync(PUB, { recursive: true, force: true });
rmSync(GEN, { recursive: true, force: true });

const errors = [];
const shows = readdirSync(join(CONTENT, "shows"))
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => readYaml(join(CONTENT, "shows", f)));

const site = { shows: [], media: {}, clips: [], collections: [] };

// A show declares its media kinds (order, group heading, chip prefix). Shows
// predating that field get the original two. Kind is presentation only: it is
// never in a URL, and no id is ever parsed to recover it.
const DEFAULT_KINDS = [
  { id: "episode", label: "Episodes", tag: "E" },
  { id: "movie", label: "Movies & specials", tag: "M" },
];

for (const show of shows) {
  show.kinds = show.kinds?.length ? show.kinds : DEFAULT_KINDS;
  const kindRank = new Map(show.kinds.map((k, i) => [k.id, i]));

  const mediaDir = join(CONTENT, "media", show.id);
  const media = readdirSync(mediaDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readYaml(join(mediaDir, f)))
    .sort((a, b) => (kindRank.get(a.kind) ?? 99) - (kindRank.get(b.kind) ?? 99) || a.number - b.number);
  for (const m of media)
    if (!kindRank.has(m.kind)) errors.push(`${show.id}/${m.id}: kind "${m.kind}" not declared in shows/${show.id}.yaml`);
  const mediaById = Object.fromEntries(media.map((m) => [m.id, m]));

  // transcripts → compact public JSON + search docs
  const searchDocs = [];
  for (const m of media) {
    const t = readJson(join(CONTENT, "transcripts", show.id, `${m.id}.json`));
    if (t.youtube !== m.youtube) errors.push(`${show.id}/${m.id}: youtube mismatch`);
    const lines = t.lines.map((l) => [l.start, l.end, l.kind, l.speaker, l.text]);
    // per-line frame overrides: {line_i: t} — else the frame is the line's midpoint
    const ovPath = join(CONTENT, "frame-overrides", show.id, `${m.id}.yaml`);
    const overrides = existsSync(ovPath) ? readYaml(ovPath) ?? {} : {};
    write(join(PUB, "transcripts", show.id, `${m.id}.json`), {
      item: m.id,
      youtube: m.youtube,
      title: m.title,
      duration: m.duration,
      lines,
      overrides,
      segments: t.segments,
    });
    for (const l of t.lines) {
      if (l.kind !== "dialog" || !l.text.trim()) continue;
      searchDocs.push([m.id, l.i, l.start, l.end, l.speaker, l.text]);
    }
  }
  write(join(PUB, "search", `${show.id}.json`), { show: show.id, docs: searchDocs });

  // clips
  const clipsDir = join(CONTENT, "clips", show.id);
  const clips = readdirSync(clipsDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => readYaml(join(clipsDir, f)));
  // attach rendered quote frames (public/frames/{show}/{slug}[.{variant}].jpg)
  const framesDir = join(ROOT, "public", "frames", show.id);
  const frameFiles = existsSync(framesDir) ? readdirSync(framesDir) : [];
  for (const c of clips) {
    const images = [];
    if (frameFiles.includes(`${c.id}.jpg`))
      images.push({ id: "default", url: `/frames/${show.id}/${c.id}.jpg` });
    for (const f of frameFiles) {
      const m = f.match(new RegExp(`^${c.id}\\.([a-z0-9-]+)\\.jpg$`));
      if (m) images.push({ id: m[1], url: `/frames/${show.id}/${f}` });
    }
    if (images.length) {
      c.images = images;
      c.image = images[0].url;
    }
  }

  const slugs = new Set();
  for (const c of clips) {
    if (slugs.has(c.id)) errors.push(`duplicate clip id ${show.id}/${c.id}`);
    slugs.add(c.id);
    const m = mediaById[c.media];
    if (!m) errors.push(`clip ${c.id}: unknown media ${c.media}`);
    else if (c.end <= c.start || c.end > (m.duration ?? Infinity) + 5)
      errors.push(`clip ${c.id}: bad range ${c.start}-${c.end}`);
  }

  // collections (running gags and other themed sets)
  const collectionsDir = join(CONTENT, "collections", show.id);
  const collections = existsSync(collectionsDir)
    ? readdirSync(collectionsDir).filter((f) => f.endsWith(".yaml")).map((f) => readYaml(join(collectionsDir, f)))
    : [];
  const clipIds = new Set(clips.map((c) => c.id));
  for (const g of collections)
    for (const cid of g.clips)
      if (!clipIds.has(cid)) errors.push(`collection ${g.id}: unknown clip ${cid}`);
  const collectionByClip = {};
  for (const g of collections) for (const cid of g.clips) collectionByClip[cid] = g.id;

  site.shows.push(show);
  site.media[show.id] = media;
  site.collections.push(...collections.map((g) => ({ ...g, show: show.id })));
  site.clips.push(...clips.map((c) => ({ ...c, show: show.id, collection: collectionByClip[c.id] ?? null })));

  write(join(PUB, "media.json"), Object.fromEntries(
    Object.entries(site.media).map(([sid, list]) => [
      sid,
      Object.fromEntries(list.map((m) => [m.id, { title: m.title, number: m.number, kind: m.kind, youtube: m.youtube, duration: m.duration }])),
    ])
  ));
  write(join(PUB, "clips.json"), site.clips.filter((c) => c.status === "published"));
}

if (errors.length) {
  console.error("content validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

write(join(GEN, "site.json"), site);

// retired /clip/{show}/{slug} pages → the same quote as a stateful /c/ URL
// (Cloudflare Pages _redirects; keeps every previously shared link alive)
const r10 = (x) => Math.round(x * 10) / 10;
const redirects = site.clips
  .filter((c) => c.status === "published")
  .flatMap((c) => {
    // qs/qe round inward — see clipUrl() in src/lib/util.js
    const qs = Math.ceil((c.quote_start ?? c.start) * 10) / 10;
    const qe = Math.floor((c.quote_end ?? c.end) * 10) / 10;
    const q = `t=${r10(c.start)}&d=${r10(c.end - c.start)}&qs=${qs}&qe=${qe}`;
    const dest = `/c/${c.show}/${c.media}/?${q}`;
    return [`/clip/${c.show}/${c.id}/ ${dest} 301`, `/clip/${c.show}/${c.id} ${dest} 301`];
  });
// groups were renamed to collections — keep the old paths alive
for (const g of site.collections)
  redirects.push(
    `/group/${g.show}/${g.id}/ /collection/${g.show}/${g.id}/ 301`,
    `/group/${g.show}/${g.id} /collection/${g.show}/${g.id}/ 301`
  );
writeFileSync(join(ROOT, "public", "_redirects"), redirects.join("\n") + "\n");
const pub = site.clips.filter((c) => c.status === "published").length;
console.log(
  `data ok: ${site.shows.length} show(s), ${Object.values(site.media).flat().length} media, ` +
  `${pub} published + ${site.clips.length - pub} draft clips`
);
