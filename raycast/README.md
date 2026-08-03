# DBZA Quotes — Raycast extension

Search all 19,400 lines of Dragon Ball Z Abridged from Raycast and walk away
with the quote, the link, or the frame.

No backend involved: the extension pulls the site's own static
`/data/search/dbza.json` + `/data/media.json`, caches them under the
extension's support path for a day (stale cache wins over a failed fetch), and
runs MiniSearch locally with the same options as the site's ⌘K — so ranking,
the `krillin: senzu` / `@krillin` speaker syntax, and the generated `/c/` links
all match what the website produces.

## Install (local dev)

```bash
cd raycast
npm install
npm run dev     # imports the extension into Raycast and hot-reloads
```

`npm run dev` keeps running; quit it with `q` and the command stays installed.

## Actions

| Key | Action |
| --- | --- |
| `↵` | open the quote page |
| `⌘C` | copy `Speaker: line` |
| `⌘⇧C` | copy the line with attribution |
| `⌘L` | copy the quote-page link |
| `⌘I` | copy the frame as an image (WebP → PNG via `sips`) |
| `⌘⇧I` | copy the frame URL |
| `⌘Y` | open YouTube at that second |
| `⌘⇧P` | list every line by that character |
| `⌘D` | toggle the preview pane |

⌘I copies the **raw frame**, not the captioned share card — cards are rendered
in-browser on canvas and only exist in R2 once someone saves them, so there's
nothing to fetch for an arbitrary line.

## Preferences

- **Site URL** — default `https://dbza-quotes.pages.dev`; change it when the
  site moves to its own domain.
- **Frame Store URL** — default `https://dbza-frames.bool.is`.

## Keeping it in sync

`src/lib.ts` mirrors three things from the site. If any of them change there,
change them here:

- `lineUrl` ← `lineHref` in `src/lib/cmdk.js`
- `frameUrl` ← `frameUrl` in `src/lib/config.js`
- the MiniSearch field/option set ← `initCmdk` in `src/lib/cmdk.js`
