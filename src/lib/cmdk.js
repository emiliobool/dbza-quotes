// Command-bar search: lives in the header on every page. Opens an overlay,
// searches every transcript line as you type, and jumps straight to the line's
// quote page on click/enter. The (heavy) index loads lazily on first open.
import { fmtTime, mediaLabel } from "./util.js";
import { frameUrl } from "./config.js";

const SHOW = "dbza";

export function initCmdk() {
  const overlay = document.getElementById("cmdk");
  const input = document.getElementById("cmdk-input");
  const resultsEl = document.getElementById("cmdk-results");
  if (!overlay || !input) return;

  let mini = null, media = null, loading = null, docs = [], speakers = [];
  let hits = [], active = 0;

  async function ensureIndex() {
    if (mini) return;
    loading ??= (async () => {
      resultsEl.innerHTML = `<p class="cmdk-note">Loading every line ever said…</p>`;
      const [{ default: MiniSearch }, searchData, mediaMap] = await Promise.all([
        import("minisearch"),
        fetch(`/data/search/${SHOW}.json`).then((r) => r.json()),
        fetch("/data/media.json").then((r) => r.json()),
      ]);
      media = mediaMap[SHOW];
      docs = searchData.docs.map(([item, i, start, end, speaker, text], id) => ({
        id, item, i, start, end, speaker: speaker || "", text,
      }));
      mini = new MiniSearch({
        fields: ["text", "speaker"],
        storeFields: ["item", "i", "start", "end", "speaker", "text"],
        searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" },
      });
      mini.addAll(docs);
      const counts = new Map();
      for (const d of docs) if (d.speaker) counts.set(d.speaker, (counts.get(d.speaker) || 0) + 1);
      speakers = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
      renderHits(input.value);
    })();
    await loading;
  }

  // "krillin: senzu" or "@krillin senzu" → filter to that character;
  // bare "krillin:" / "@krillin" → list all their lines in order
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  function parseQuery(q) {
    let m = q.match(/^\s*@(\S+)\s*(.*)$/) || q.match(/^\s*([^:]{2,30}):\s*(.*)$/);
    if (m) {
      const want = squash(m[1]);
      const sp = want && speakers.find((s) => squash(s.name) === want || squash(s.name).startsWith(want));
      if (sp) return { speaker: sp.name, text: m[2] };
    }
    return { speaker: null, text: q };
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hl = (text, q) => {
    let out = esc(text);
    for (const tok of q.toLowerCase().split(/\s+/).filter((t) => t.length > 1)) {
      out = out.replace(new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
    }
    return out;
  };

  const lineHref = (h) => {
    const r = (x) => Math.round(x * 10) / 10;
    const t = Math.max(0, h.start - 1);
    return `/c/${SHOW}/${h.item}/?t=${r(t)}&d=${r(h.end + 1.5 - t)}&qs=${r(h.start)}&qe=${r(h.end)}`;
  };

  function renderHits(q) {
    const { speaker, text } = parseQuery(q);
    active = 0;
    if (speaker && !text.trim()) {
      hits = docs.filter((d) => d.speaker === speaker).slice(0, 50);
    } else if (text.trim()) {
      hits = mini
        .search(text, speaker ? { filter: (r) => r.speaker === speaker } : undefined)
        .slice(0, speaker ? 50 : 20);
    } else {
      hits = [];
      const chips = speakers.slice(0, 14).map((s) =>
        `<button class="cmdk-chip" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join("");
      resultsEl.innerHTML = `<p class="cmdk-note">Type to search every line — or pick a character
        (also: <code>krillin: text</code>)</p><div class="cmdk-chips">${chips}</div>`;
      return;
    }
    if (!hits.length) {
      resultsEl.innerHTML = `<p class="cmdk-note">Nothing. Not even a senzu bean.</p>`;
      return;
    }
    const head = speaker
      ? `<p class="cmdk-note"><strong>${esc(speaker)}</strong> — ${
          text.trim() ? "matching lines" : `${docs.filter((d) => d.speaker === speaker).length.toLocaleString()} lines`
        }</p>`
      : "";
    resultsEl.innerHTML = head + hits.map((h, k) => `
      <a class="cmdk-hit${k === 0 ? " on" : ""}" href="${lineHref(h)}" data-k="${k}">
        <img loading="lazy" decoding="async" crossorigin="anonymous" src="${frameUrl(h.item, (h.start + h.end) / 2)}" alt="" onerror="this.style.visibility='hidden'">
        <span class="cmdk-text">${h.speaker ? `<span class="speaker">${esc(h.speaker)}:</span> ` : ""}${hl(h.text, text)}</span>
        <span class="cmdk-meta">${esc(mediaLabel(media[h.item]).replace("Episode", "Ep"))} · ${fmtTime(h.start)}</span>
      </a>`).join("");
  }

  function setActive(k) {
    active = Math.max(0, Math.min(hits.length - 1, k));
    resultsEl.querySelectorAll(".cmdk-hit").forEach((el, i) => el.classList.toggle("on", i === active));
    resultsEl.querySelector(".cmdk-hit.on")?.scrollIntoView({ block: "nearest" });
  }

  function open() {
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    input.focus();
    input.select();
    ensureIndex().then(() => renderHits(input.value));
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = "";
  }

  document.querySelectorAll("#cmdk-open, [data-cmdk-open]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); open(); });
    if (el.tagName === "INPUT") el.addEventListener("focus", open);
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // old-style /?q=... links land in the command bar
  const q0 = new URLSearchParams(location.search).get("q");
  if (q0) { input.value = q0; open(); }
  resultsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".cmdk-chip");
    if (chip) {
      input.value = `${chip.dataset.name}: `;
      input.focus();
      renderHits(input.value);
    }
  });

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (mini) renderHits(input.value); }, 90);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const el = resultsEl.querySelector(".cmdk-hit.on");
      if (el) location.href = el.href;
    }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      overlay.hidden ? open() : close();
    } else if (e.key === "/" && overlay.hidden && !typing) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && !overlay.hidden) {
      close();
    }
  });
}
