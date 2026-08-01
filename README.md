# DBZA Quotes

Search every line of Dragon Ball Z Abridged, link any moment, share clips.
Static-first: the whole site works with zero backend; one tiny optional Pages
Function adds OG unfurls and a moderated submission queue.

## Layout

```
content/            the database (files in git)
  shows/            show metadata + sources
  media/dbza/       one YAML per episode/movie (e01..e69, m01..m12)
  transcripts/dbza/ cleaned speaker-attributed transcripts (+ clip-worthy segments)
  clips/dbza/       curated clips; status: published|draft
tools/
  import_from_dba.py  migration from ../dba-video-clips (re-runnable)
  build-data.mjs      content → public/data + src/gen (runs before every build)
src/                Astro site (static output)
functions/          Pages Functions: OG injection, /api/submit, /api/queue*
db/schema.sql       D1 schema (submissions table — the only dynamic state)
```

## Develop

```bash
npm install
npm run dev        # rebuilds data, serves the site (no functions)
npm run pages:dev  # full build + functions via wrangler
```

## Publish a clip

Edit `content/clips/dbza/{slug}.yaml`, set `status: published`, commit. Deploy
picks it up. Drafts (66 of the reddit-mined seeds) are invisible until flipped.

## Deploy (Cloudflare Pages, all free tier)

1. Push this repo to GitHub; create a Pages project from it.
   Build command: `npm run build` — output dir `dist`.
2. Optional (submissions): `npx wrangler d1 create dbza-quotes`, apply
   `db/schema.sql` with `d1 execute --remote`, uncomment the binding in
   `wrangler.toml`, set secrets `ADMIN_TOKEN`, `IP_SALT`, and (recommended)
   `TURNSTILE_SECRET` + a Turnstile site key in the submit UI.
3. No card on the account. Worst case under load: functions hit the 100k/day
   cap → submissions and rich unfurls pause; the static site is unaffected.

## Agent API

- `GET /api/queue?status=pending` (Bearer ADMIN_TOKEN) — review inbox
- `POST /api/queue/{id}` `{action: approve|reject, note}` — annotate
- Publishing is never an API call: write the clip YAML, commit, CI deploys.
