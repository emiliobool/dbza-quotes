// Everything that must agree with the site lives here: the URL shapes are
// straight ports of src/lib/cmdk.js (lineHref) and src/lib/config.js
// (frameUrl) in the dbza-quotes repo. If a link ever comes out different from
// what the site's own ⌘K produces, it's this file that drifted.
import { environment, getPreferenceValues } from "@raycast/api";
import MiniSearch from "minisearch";
import fs from "node:fs/promises";
import path from "node:path";

export const SHOW = "dbza";
const DAY = 24 * 60 * 60 * 1000;

export type Prefs = { site: string; frames: string };

export function prefs(): Prefs {
  const p = getPreferenceValues<Partial<Prefs>>();
  const clean = (v: string | undefined, fallback: string) =>
    (v?.trim() || fallback).replace(/\/+$/, "");
  return {
    site: clean(p.site, "https://dbza-quotes.pages.dev"),
    frames: clean(p.frames, "https://dbza-frames.bool.is"),
  };
}

export type Doc = {
  id: number;
  item: string;
  i: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
  /** position within its episode, for pulling neighbouring lines */
  pos: number;
};

export type Media = {
  title: string;
  number: number;
  kind: string;
  youtube: string;
  duration: number;
};

export type Index = {
  docs: Doc[];
  mini: MiniSearch<Doc>;
  media: Record<string, Media>;
  speakers: { name: string; n: number }[];
  byItem: Map<string, Doc[]>;
};

const r = (x: number) => Math.round(x * 10) / 10;

export function fmtTime(s: number) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export const mediaLabel = (m?: Media) => m?.title ?? "";

/** Frame n covers t=(n-1)*0.5 — one WebP every half second, straight from R2. */
export function frameUrl(frames: string, item: string, t: number) {
  const n = Math.max(1, Math.round(t * 2) + 1);
  return `${frames}/${item}/grid/${String(n).padStart(6, "0")}.webp`;
}

export const lineFrameT = (d: Doc) => (d.start + d.end) / 2;

/** The quote page for a line. Same shape as the site's cmdk links, except
 *  qs/qe round INWARD like clipUrl in src/lib/util.js: the page picks lines by
 *  overlap, so rounding qs down to the nearest 0.1 lassoes whatever direction
 *  or line ended exactly where this one starts, and the quote opens as a
 *  2- or 3-panel collage. Inward rounding is safe — no line in the index is
 *  short enough for qs to meet qe. */
export function lineUrl(site: string, d: Doc) {
  const t = Math.max(0, d.start - 1);
  const qs = Math.ceil(d.start * 10) / 10;
  const qe = Math.floor(d.end * 10) / 10;
  return `${site}/c/${SHOW}/${d.item}/?t=${r(t)}&d=${r(d.end + 1.5 - t)}&qs=${qs}&qe=${qe}`;
}

export function ytUrl(m: Media | undefined, t: number) {
  return m?.youtube
    ? `https://youtu.be/${m.youtube}?t=${Math.floor(Math.max(0, t))}`
    : undefined;
}

export function quoteText(d: Doc) {
  return d.speaker ? `${d.speaker}: ${d.text}` : d.text;
}

export function attributedQuote(d: Doc, m?: Media) {
  const where = [mediaLabel(m), fmtTime(d.start)].filter(Boolean).join(" · ");
  return `"${d.text}" — ${d.speaker || "Unknown"}${where ? `, ${where}` : ""}`;
}

/** Fetch + disk-cache a JSON file; stale cache beats a failed request. */
async function cachedJson<T>(
  url: string,
  file: string,
  maxAge = DAY,
): Promise<T> {
  const p = path.join(environment.supportPath, file);
  const readCache = async () => JSON.parse(await fs.readFile(p, "utf8")) as T;
  try {
    const st = await fs.stat(p);
    if (Date.now() - st.mtimeMs < maxAge) return await readCache();
  } catch {
    // no cache yet
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const text = await res.text();
    await fs.mkdir(environment.supportPath, { recursive: true });
    await fs.writeFile(p, text);
    return JSON.parse(text) as T;
  } catch (err) {
    return await readCache().catch(() => {
      throw err;
    });
  }
}

type SearchFile = {
  show: string;
  docs: [string, number, number, number, string, string][];
};

export async function loadIndex(): Promise<Index> {
  const { site } = prefs();
  const [search, mediaMap] = await Promise.all([
    cachedJson<SearchFile>(
      `${site}/data/search/${SHOW}.json`,
      `search-${SHOW}.json`,
    ),
    cachedJson<Record<string, Record<string, Media>>>(
      `${site}/data/media.json`,
      "media.json",
    ),
  ]);

  const byItem = new Map<string, Doc[]>();
  const docs: Doc[] = search.docs.map(
    ([item, i, start, end, speaker, text], id) => {
      const list = byItem.get(item) ?? [];
      const doc: Doc = {
        id,
        item,
        i,
        start,
        end,
        speaker: speaker || "",
        text,
        pos: list.length,
      };
      list.push(doc);
      byItem.set(item, list);
      return doc;
    },
  );

  // same fields/options as the site's command bar, so ranking matches
  const mini = new MiniSearch<Doc>({
    fields: ["text", "speaker"],
    storeFields: ["item", "i", "start", "end", "speaker", "text", "pos"],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" },
  });
  mini.addAll(docs);

  const counts = new Map<string, number>();
  for (const d of docs)
    if (d.speaker) counts.set(d.speaker, (counts.get(d.speaker) ?? 0) + 1);
  const speakers = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n }));

  return { docs, mini, media: mediaMap[SHOW] ?? {}, speakers, byItem };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "krillin: senzu" or "@krillin senzu" narrows to a character; bare "@krillin"
 *  lists all their lines in order. Ported from cmdk.js. */
export function parseQuery(q: string, speakers: Index["speakers"]) {
  const m =
    q.match(/^\s*@(\S+)\s*(.*)$/) || q.match(/^\s*([^:]{2,30}):\s*(.*)$/);
  if (m) {
    const want = squash(m[1]);
    const sp =
      want &&
      speakers.find(
        (s) => squash(s.name) === want || squash(s.name).startsWith(want),
      );
    if (sp) return { speaker: sp.name, text: m[2] };
  }
  return { speaker: null as string | null, text: q };
}

export function runSearch(index: Index, query: string): Doc[] {
  const { speaker, text } = parseQuery(query, index.speakers);
  if (speaker && !text.trim())
    return index.docs.filter((d) => d.speaker === speaker).slice(0, 100);
  if (!text.trim()) return [];
  const hits = index.mini.search(
    text,
    speaker ? { filter: (r) => r.speaker === speaker } : undefined,
  );
  return hits
    .slice(0, speaker ? 100 : 40)
    .map((h) => index.docs[h.id as number]);
}

/** A few lines either side, for the detail pane. */
export function context(index: Index, d: Doc, span = 2) {
  const list = index.byItem.get(d.item) ?? [];
  return list.slice(Math.max(0, d.pos - span), d.pos + span + 1);
}
