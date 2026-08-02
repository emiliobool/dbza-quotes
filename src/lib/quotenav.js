// Quote navigator: the transcript is the UI. Click a line → that's the quote
// (a saved line becomes its clip page; anything else becomes a stateless /c/
// URL) — title, player window, links, and the image maker all follow. No
// separate editor page, no reload.
import { createClipPlayer } from "./player.js";
import { fmtTime } from "./util.js";
import { frameUrl, lineFrameT } from "./config.js";

const PAD_S = 1.0, PAD_E = 1.5; // ad-hoc context padding around the quote

export async function initQuoteNav(cfg) {
  const $ = (s) => document.querySelector(s);
  const lines = cfg.lines; // [start, end, kind, speaker, text]
  const lineEls = [...document.querySelectorAll("#dialog .line")];

  const st = {
    sel: [0],                    // selected line indices, sorted — gaps allowed
    curated: null,               // adopted saved clip or null
    ctxStart: 0, ctxEnd: 10,     // player window
    frameTs: new Map(),          // per-line frame picks (line index → time)
    cols: 1,                     // panels per row for multi-line images
    openStrip: null,             // line index whose frame carousel is open
    editPanel: null,             // panel index (k) whose caption editor is open
  };

  const clampT = (t) => Math.max(0, Math.min(cfg.duration ?? t, t));
  const selFirst = () => st.sel[0];
  const selLast = () => st.sel[st.sel.length - 1];
  const isSel = (i) => st.sel.includes(i);
  const rangeArr = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const contiguous = () => st.sel.length === selLast() - selFirst() + 1;

  // Scroll within the panel only — never drag the page (on mobile the panel
  // isn't its own scroll container, so we simply don't auto-scroll there).
  const panel = $("#dialog");
  function scrollPanelTo(el, center = false) {
    if (!el || panel.scrollHeight <= panel.clientHeight + 20) return;
    const top = el.offsetTop - panel.offsetTop;
    const target = top - (center ? panel.clientHeight / 2 - el.clientHeight / 2 : panel.clientHeight * 0.4);
    if (center || Math.abs(panel.scrollTop - target) > panel.clientHeight * 0.35)
      panel.scrollTop = Math.max(0, target);
  }

  // ---------- init from prerendered state / URL ----------
  function selFromRange(qs, qe) {
    let a = -1, b = -1;
    lines.forEach((l, i) => {
      if (l[1] > qs && l[0] < qe) { if (a === -1) a = i; b = i; }
    });
    return a === -1 ? null : [a, b];
  }

  function initState() {
    const params = new URLSearchParams(location.search);
    if (cfg.clip && !params.has("t")) {
      st.curated = cfg.clip;
      st.ctxStart = cfg.clip.start; st.ctxEnd = cfg.clip.end;
      const sel = selFromRange(cfg.clip.qStart, cfg.clip.qEnd) ?? selFromRange(cfg.clip.start, cfg.clip.end);
      if (sel) st.sel = rangeArr(sel[0], sel[1]);
    } else {
      const t = Math.max(0, parseFloat(params.get("t") ?? "0") || 0);
      const d = parseFloat(params.get("d") ?? "15") || 15;
      const qs = parseFloat(params.get("qs"));
      const qe = parseFloat(params.get("qe"));
      st.ctxStart = t; st.ctxEnd = Math.min(cfg.duration ?? t + d, t + d);
      const sel = Number.isFinite(qs) && Number.isFinite(qe)
        ? selFromRange(qs, qe)
        : selFromRange(t + 0.01, st.ctxEnd - 0.01);
      if (sel) st.sel = rangeArr(sel[0], sel[1]);
      // sparse selection: ?sel= lists the picked line indices
      const selP = params.get("sel");
      if (selP) {
        const picked = [...new Set(
          selP.split(",").map((v) => parseInt(v, 10))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < lines.length)
            .slice(0, 40)
        )].sort((x, y) => x - y);
        if (picked.length) st.sel = picked;
      }
      st.curated = matchCurated();
    }
    // shared image state: custom frames (one per selected line) + edited caption
    const f = params.get("f");
    if (f)
      f.split(",").forEach((v, k) => {
        const t = parseFloat(v);
        if (Number.isFinite(t) && k < st.sel.length) st.frameTs.set(st.sel[k], clampT(t));
      });
    const cols = parseInt(params.get("cols"), 10);
    if (cols === 2 || cols === 3) st.cols = 2; // 3-up retired; old links get 2-up
    st.pendingTxt = params.get("txt");
  }

  function selLines() {
    return st.sel.map((i) => ({ l: lines[i], i }));
  }
  function quoteSpan() {
    const sel = selLines();
    if (!sel.length) return [st.ctxStart, st.ctxEnd];
    return [sel[0].l[0], sel[sel.length - 1].l[1]];
  }
  const defFrameFor = (i) => lineFrameT(lines[i], i, cfg.overrides);
  const frameFor = (i) => st.frameTs.get(i) ?? defFrameFor(i);
  function quoteText(withSpeakers = true) {
    return selLines()
      .map(({ l }) =>
        l[2] !== "dialog" ? `[${l[4]}]` : withSpeakers && l[3] ? `${l[3]}: ${l[4]}` : l[4])
      .join("\n");
  }
  function matchCurated() {
    if (st.sel.length !== 1) return null;
    const l = lines[st.sel[0]];
    const mid = (l[0] + l[1]) / 2;
    return cfg.itemClips.find((c) => c.qStart <= mid && mid <= c.qEnd) ?? null;
  }

  // ---------- player ----------
  initState(); // before the player so it cues at the real clip start
  const player = await createClipPlayer({
    mountId: "yt-player",
    youtube: cfg.youtube,
    lines,
    captionEl: $("#caption"),
    controlsEl: $("#controls"),
    start: st.ctxStart, end: st.ctxEnd, loop: true,
    onTime: (t, playing) => {
      // playhead highlight: only while the video is visible AND rolling —
      // a paused player shouldn't leave rows lit up like a selection
      const imgMode = !document.getElementById("tab-image")?.hidden;
      for (const el of lineEls) {
        const active = playing && !imgMode && +el.dataset.t <= t && t <= +el.dataset.e + 0.3;
        if (active && !el.classList.contains("active")) scrollPanelTo(el);
        el.classList.toggle("active", active);
      }
    },
  });

  // ---------- render ----------
  function currentUrl() {
    const h = location.hash === "#video" ? "#video" : "";
    const r = (x) => Math.round(x * 10) / 10;
    // customized image state travels in the URL so shared links reproduce it
    const extras = new URLSearchParams();
    const sel = selLines();
    if (sel.some(({ i }) => Math.abs(frameFor(i) - defFrameFor(i)) > 0.26))
      extras.set("f", sel.map(({ i }) => r(frameFor(i))).join(","));
    if (sel.length > 1 && st.cols > 1) extras.set("cols", st.cols);
    if (!contiguous()) extras.set("sel", st.sel.join(","));
    const txt = imgText?.value ?? "";
    if (txt && txt !== quoteText(false)) extras.set("txt", txt.slice(0, 300));
    const ex = extras.toString();
    if (st.curated) return `/clip/${cfg.show}/${st.curated.id}/${ex ? `?${ex}` : ""}${h}`;
    const [qs, qe] = quoteSpan();
    return `/c/${cfg.show}/${cfg.item}/?t=${r(st.ctxStart)}&d=${r(st.ctxEnd - st.ctxStart)}&qs=${r(qs)}&qe=${r(qe)}${ex ? `&${ex}` : ""}${h}`;
  }

  function pageTitle() {
    const first = selLines()[0];
    return st.curated
      ? st.curated.title
      : first ? (first.l[4].length > 64 ? first.l[4].slice(0, 61) + "…" : first.l[4]) : cfg.mediaTitle;
  }

  function render(push = true) {
    const sel = selLines();
    document.title = `"${pageTitle()}" — ${cfg.mediaTitle} | DBZA Quotes`;

    for (const el of lineEls) el.classList.toggle("in-quote", isSel(+el.dataset.i));
    player.setRange(st.ctxStart, st.ctxEnd);
    $("#img-gif").hidden = sel.length < 2;
    const cb = $("#cols-btn");
    if (cb) { cb.hidden = sel.length < 2; markCols(); }
    closeEditor(); // any open caption editor died with the old selection
    imgState.text = quoteText(false);
    if (imgText) imgText.value = imgState.text;
    if (push) history.pushState({ sel: [...st.sel], cs: st.ctxStart, ce: st.ctxEnd }, "", currentUrl());
    if (!$("#tab-image").hidden) { buildImageUI(); drawCard(); }
  }

  // shared tail of every selection change (contiguous or sparse)
  function afterSelChange(play) {
    st.curated = matchCurated();
    if (st.curated) {
      st.ctxStart = st.curated.start; st.ctxEnd = st.curated.end;
    } else {
      const [qs, qe] = quoteSpan();
      st.ctxStart = Math.max(0, qs - PAD_S);
      st.ctxEnd = Math.min(cfg.duration ?? qe + PAD_E, qe + PAD_E);
    }
    // frame picks survive grow/shrink but reset for lines that left the selection
    for (const k of [...st.frameTs.keys()]) if (!isSel(k)) st.frameTs.delete(k);
    render();
    // don't start (hidden) playback while the image tab is up
    if (play && $("#tab-image").hidden)
      player.seek(quoteSpan()[0] - 0.2 < st.ctxStart ? st.ctxStart : quoteSpan()[0] - 0.2);
  }

  function navigateTo(a, b, { play = true } = {}) {
    st.sel = rangeArr(Math.min(a, b), Math.max(a, b));
    afterSelChange(play);
  }

  // cmd/ctrl-click or the per-line ± button: one line in or out, gaps allowed
  function toggleLine(i, { play = false } = {}) {
    if (isSel(i) && st.sel.length === 1) return; // never empty
    st.sel = isSel(i) ? st.sel.filter((x) => x !== i) : [...st.sel, i].sort((x, y) => x - y);
    afterSelChange(play);
  }

  // ---------- transcript interaction ----------
  // click = select exactly that line; shift-click / "+" handles / shift+arrows
  // grow the selection
  let anchor = null, focusEnd = null; // text-editor selection: fixed anchor, moving focus
  // shift-click extends the quote selection — keep the browser from also
  // sweeping a native text selection across the transcript
  panel.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); });
  $("#dialog").addEventListener("click", (e) => {
    const el = e.target.closest(".line");
    if (!el) return;
    const i = +el.dataset.i;
    if (e.target.closest(".lsel") || e.metaKey || e.ctrlKey) {
      toggleLine(i);
      anchor = i; focusEnd = i;
    } else if (e.shiftKey && anchor !== null) { focusEnd = i; navigateTo(anchor, i); }
    else { anchor = i; focusEnd = i; navigateTo(i, i); }
  });

  window.addEventListener("popstate", (e) => {
    if (e.state) {
      st.sel = e.state.sel ?? rangeArr(e.state.a ?? 0, e.state.b ?? 0);
      st.ctxStart = e.state.cs; st.ctxEnd = e.state.ce;
      st.curated = matchCurated();
      for (const k of [...st.frameTs.keys()]) if (!isSel(k)) st.frameTs.delete(k);
      render(false);
    }
  });

  // ---------- image/video toggle (hash-driven so #video deep-links) ----------
  // image is the default; #video opts into the player
  const toggle = $("#tab-toggle");
  function applyTab(autoplay = false) {
    const img = location.hash !== "#video";
    $("#tab-video").hidden = img;
    $("#tab-image").hidden = !img;
    if (toggle) {
      toggle.href = img ? "#video" : "#image";
      toggle.title = img ? "Watch the clip" : "Back to the image";
      $("#tt-video").hidden = !img;
      $("#tt-image").hidden = img;
    }
    if (img) { player.pause(); buildImageUI(); drawCard(); }
    else if (autoplay) {
      // the user clicked over to the video — roll it from the quote
      player.seek(Math.max(st.ctxStart, quoteSpan()[0] - 0.2));
    } else {
      // page load on #video: line the player up with the clip window. Only
      // seek a player that has already been started — seekTo() on a
      // freshly-cued player kicks off playback, which we don't want on load.
      const yt = player.raw();
      const started = [1, 2, 3].includes(yt?.getPlayerState?.());
      const t = yt?.getCurrentTime?.() ?? null;
      if (started && t !== null && (t < st.ctxStart - 0.5 || t > st.ctxEnd))
        player.seek(st.ctxStart, false);
    }
  }
  window.addEventListener("hashchange", () => applyTab(true));

  // ---------- image maker ----------
  const canvas = $("#imgcanvas");
  const ctx2d = canvas?.getContext("2d");
  const imgText = $("#imgtext");
  const imgState = { text: "" };
  const frameCache = new Map();

  function loadFrame(t) {
    const url = frameUrl(cfg.item, Math.min(t, cfg.duration ?? t));
    if (!frameCache.has(url)) {
      const p = new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      });
      p.catch(() => frameCache.delete(url)); // don't memoize failures
      frameCache.set(url, p);
    }
    return frameCache.get(url);
  }

  // Wrap + measure the caption exactly as it will be painted, so the click
  // target over the words can hug the words (and nothing else).
  function captionLayout(c, text, W, H) {
    if (!text.trim()) return null;
    const size = Math.max(20, Math.round(W / 21));
    c.font = `bold ${size}px "Arial", sans-serif`;
    const maxW = W * 0.92;
    const out = [];
    for (const para of text.split("\n")) {
      let cur = "";
      for (const w of para.split(/\s+/)) {
        const trial = (cur + " " + w).trim();
        if (c.measureText(trial).width <= maxW) cur = trial;
        else { if (cur) out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
    }
    const show = out.slice(0, 5);
    const lh = size * 1.16;
    const yBase = H - show.length * lh - H * 0.035 + size; // first line's baseline
    const width = Math.min(maxW, Math.max(...show.map((ln) => c.measureText(ln).width)));
    return { show, size, lh, yBase, width };
  }

  function drawCaption(c, text, W, H) {
    const lay = captionLayout(c, text, W, H);
    if (!lay) return;
    c.textAlign = "center";
    c.lineJoin = "round";
    let y = lay.yBase;
    for (const ln of lay.show) {
      c.strokeStyle = "black"; c.lineWidth = Math.max(3, lay.size / 6);
      c.strokeText(ln, W / 2, y);
      c.fillStyle = "white";
      c.fillText(ln, W / 2, y);
      y += lay.lh;
    }
  }

  // Textarea line k captions panel k; extra trailing lines stay on the last
  // panel (so a single panel still takes the whole text, paragraphs and all).
  function panelTexts() {
    const n = selLines().length;
    const parts = (imgText?.value ?? imgState.text).split("\n");
    if (n <= 1) return [parts.join("\n")];
    const out = parts.slice(0, n - 1);
    out.push(parts.slice(n - 1).join("\n"));
    return out;
  }

  // One panel per selected line — its frame, its caption — tiled st.cols wide.
  async function drawCard() {
    if (!ctx2d) return;
    const sel = selLines();
    const texts = panelTexts();
    $("#flabel").textContent = sel.length === 1 ? fmtTime(frameFor(sel[0].i)) : "";
    try {
      const imgs = await Promise.all(sel.map(({ i }) => loadFrame(frameFor(i))));
      const pw = 640;
      const ph = Math.round(imgs[0].height * (pw / imgs[0].width));
      const cols = Math.min(sel.length === 1 ? 1 : st.cols, sel.length);
      canvas.width = pw * cols;
      canvas.height = ph * Math.ceil(sel.length / cols);
      imgs.forEach((im, k) => {
        ctx2d.save();
        ctx2d.translate((k % cols) * pw, Math.floor(k / cols) * ph);
        ctx2d.drawImage(im, 0, 0, pw, ph);
        drawCaption(ctx2d, texts[k] ?? "", pw, ph);
        ctx2d.restore();
      });
      placeTxtZones(sel, texts, pw, ph);
      $("#img-note").hidden = true;
    } catch {
      canvas.width = 640; canvas.height = 360;
      ctx2d.fillStyle = "#141821";
      ctx2d.fillRect(0, 0, 640, 360);
      drawCaption(ctx2d, imgText?.value ?? imgState.text, 640, 360);
      $("#img-note").hidden = false;
    }
  }

  // columns button: one overlay control that toggles 1 ↔ 2 panels per row,
  // its icon mirroring the current layout
  const colsBtn = $("#cols-btn");
  function markCols() {
    for (const s of colsBtn?.children ?? []) s.hidden = +s.dataset.cols !== st.cols;
    if (colsBtn) colsBtn.title = st.cols === 1 ? "1 per row — click for 2" : "2 per row — click for 1";
  }
  colsBtn?.addEventListener("click", () => {
    st.cols = st.cols === 1 ? 2 : 1;
    markCols();
    buildImageUI(); // panel geometry changed → hit-zones move
    drawCard();
    syncUrl();
  });

  // The canvas is the control surface: an invisible hit-zone sits over every
  // rendered panel. Tap anywhere on the picture → a frame-carousel popup for
  // that panel; tap the painted words themselves → a caption-editor popup.
  const hits = $("#panel-hits");
  const strips = $("#fstrips");
  const canvasWrap = document.querySelector("#tab-image .canvas-wrap");
  const ICO_FILM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 3 3 3-3 3 3"/></svg>`;
  const ICO_PEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;

  function panelGrid() {
    const sel = selLines();
    const cols = Math.min(sel.length === 1 ? 1 : st.cols, sel.length);
    return { sel, cols, rows: Math.ceil(sel.length / cols) };
  }

  // fallback caption zone (no words yet): a strip along the panel's bottom
  const EMPTY_TXT_RECT = { left: "10%", top: "78%", width: "80%", height: "18%" };

  function buildPanelHits() {
    if (!hits) return;
    hits.innerHTML = "";
    const { sel, cols, rows } = panelGrid();
    sel.forEach(({ i }, k) => {
      const p = document.createElement("div");
      p.className = "phit";
      p.style.left = `${((k % cols) / cols) * 100}%`;
      p.style.top = `${(Math.floor(k / cols) / rows) * 100}%`;
      p.style.width = `${100 / cols}%`;
      p.style.height = `${100 / rows}%`;
      const img = document.createElement("div");
      img.className = "phit-img";
      img.title = "Change this panel's frame";
      img.innerHTML = `<span class="phit-ico">${ICO_FILM}</span>`;
      img.addEventListener("click", () => (st.openStrip === i ? closeStrip() : openStripFor(i)));
      const txt = document.createElement("div");
      txt.className = "phit-txt";
      txt.title = "Edit this caption";
      txt.innerHTML = `<span class="phit-ico">${ICO_PEN}</span>`;
      Object.assign(txt.style, EMPTY_TXT_RECT);
      txt.addEventListener("click", () => openEditor(k));
      p.append(img, txt);
      hits.appendChild(p);
    });
    markStripOpen();
  }

  // After each draw, move every caption hit-zone to hug its painted words.
  function placeTxtZones(sel, texts, pw, ph) {
    const zones = hits ? [...hits.children] : [];
    sel.forEach((_, k) => {
      const z = zones[k]?.querySelector(".phit-txt");
      if (!z) return;
      const lay = captionLayout(ctx2d, texts[k] ?? "", pw, ph);
      if (!lay) { Object.assign(z.style, EMPTY_TXT_RECT); return; }
      const pad = lay.size * 0.5;
      const x = Math.max(0, pw / 2 - lay.width / 2 - pad);
      const y = Math.max(0, lay.yBase - lay.size);
      const w = Math.min(pw - x, lay.width + pad * 2);
      const h = Math.min(ph - y, lay.show.length * lay.lh + lay.size * 0.3);
      z.style.left = `${(x / pw) * 100}%`;
      z.style.top = `${(y / ph) * 100}%`;
      z.style.width = `${(w / pw) * 100}%`;
      z.style.height = `${(h / ph) * 100}%`;
    });
  }

  function markStripOpen() {
    const { sel } = panelGrid();
    [...(hits?.children ?? [])].forEach((el, k) =>
      el.classList.toggle("strip-open", sel[k]?.i === st.openStrip));
  }

  // Popups anchor just below their panel's row, floating over whatever's there.
  function placePop(el, k) {
    const { cols, rows } = panelGrid();
    el.style.top = `calc(${((Math.floor(k / cols) + 1) / rows) * 100}% + 6px)`;
  }

  // Caption editor popup: floats under the panel so the live caption on the
  // canvas stays visible while you type. Writes into the hidden master
  // textarea (line k ↔ panel k), so ?txt=, the GIF, and saves keep working.
  let editPop = null;
  function closeEditor() {
    st.editPanel = null;
    editPop?.remove();
    editPop = null;
  }
  function openEditor(k) {
    closeStrip();
    closeEditor();
    st.editPanel = k;
    const n = selLines().length;
    editPop = document.createElement("div");
    editPop.className = "canvas-pop edit-pop";
    placePop(editPop, k);
    const ta = document.createElement("textarea");
    ta.rows = 2;
    ta.title = "This panel's caption — your words";
    ta.value = panelTexts()[k] ?? "";
    ta.addEventListener("input", () => {
      const texts = panelTexts();
      // newlines only mean something on the last panel — elsewhere they'd
      // shift the line↔panel mapping, so they flatten to spaces
      texts[k] = k < n - 1 ? ta.value.replace(/\n/g, " ") : ta.value;
      if (imgText) imgText.value = texts.join("\n");
      drawCard();
      clearTimeout(txtTimer);
      txtTimer = setTimeout(syncUrl, 350);
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && k < n - 1)) {
        e.preventDefault();
        closeEditor();
      }
      e.stopPropagation();
    });
    ta.addEventListener("blur", () =>
      setTimeout(() => { if (st.editPanel === k && document.activeElement !== ta) closeEditor(); }, 0));
    editPop.appendChild(ta);
    canvasWrap?.appendChild(editPop);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // Frame picker: a scrollable grid of frames covering exactly the tapped
  // panel — the panel becomes its own control. Picking a frame closes it so
  // the result shows immediately.
  const stripDocClose = (e) => { if (!e.target.closest(".canvas-wrap")) closeStrip(); };
  function openStripFor(i) {
    if (!strips) return;
    closeEditor();
    st.openStrip = i;
    strips.hidden = false;
    document.addEventListener("click", stripDocClose);
    // cover the picked panel, and only it
    const { cols, rows } = panelGrid();
    const k = st.sel.indexOf(i);
    strips.style.left = `${((k % cols) / cols) * 100}%`;
    strips.style.top = `${(Math.floor(k / cols) / rows) * 100}%`;
    strips.style.width = `${100 / cols}%`;
    strips.style.height = `${100 / rows}%`;
    strips.innerHTML = "";
    const l = lines[i];
    const scroll = document.createElement("div");
    scroll.className = "fgrid-scroll";
    const grid = document.createElement("div");
    grid.className = "fgrid";
    grid.title = "Pick a different frame";
    const pad = 3;
    const from = Math.max(0, Math.round((l[0] - pad) * 2) / 2);
    const to = Math.min(cfg.duration ?? l[1] + pad, l[1] + pad);
    for (let t = from; t <= to; t += 0.5) {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.loading = "lazy";
      im.src = frameUrl(cfg.item, t);
      im.dataset.t = t;
      im.title = fmtTime(t);
      im.addEventListener("click", () => {
        st.frameTs.set(i, +im.dataset.t);
        drawCard();
        syncUrl();
        closeStrip();
      });
      grid.appendChild(im);
    }
    scroll.appendChild(grid);
    strips.appendChild(scroll);
    const x = document.createElement("button");
    x.className = "fs-close";
    x.title = "Close";
    x.textContent = "×";
    x.addEventListener("click", closeStrip);
    strips.appendChild(x);
    markFilmstrip();
    strips.querySelector(".fgrid .on")?.scrollIntoView({ block: "center" });
    markStripOpen();
  }
  function closeStrip() {
    st.openStrip = null;
    if (strips) { strips.innerHTML = ""; strips.hidden = true; }
    document.removeEventListener("click", stripDocClose);
    markStripOpen();
  }
  function markFilmstrip() {
    if (!strips || st.openStrip == null) return;
    const grid = strips.querySelector(".fgrid");
    if (!grid) return;
    const t = frameFor(st.openStrip);
    for (const el of grid.children) el.classList.toggle("on", Math.abs(+el.dataset.t - t) < 0.26);
  }

  // rebuild hit-zones + carry (or drop) the open popups across a re-render
  function buildImageUI() {
    if (st.openStrip != null && !isSel(st.openStrip)) closeStrip();
    buildPanelHits();
    if (st.openStrip != null) openStripFor(st.openStrip);
    if (editPop && st.editPanel != null) placePop(editPop, st.editPanel);
  }

  // keep the address bar in sync with customizations (replace, don't push)
  function syncUrl() {
    history.replaceState({ sel: [...st.sel], cs: st.ctxStart, ce: st.ctxEnd }, "", currentUrl());
  }
  let txtTimer;

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  };

  function fileName(ext) {
    const base = (st.curated?.id ?? quoteText(false).slice(0, 32) ?? "quote")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${base || "quote"}.${ext}`;
  }

  $("#img-download")?.addEventListener("click", () =>
    canvas.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = fileName("png");
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png")
  );
  $("#img-copy")?.addEventListener("click", () =>
    canvas.toBlob(async (b) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
        toast("Image copied");
      } catch { toast("Copy not supported here — use Download"); }
    }, "image/png")
  );

  $("#img-gif")?.addEventListener("click", async () => {
    const sel = selLines();
    if (sel.length < 2) return;
    toast("Building GIF…");
    try {
      const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
      const gif = GIFEncoder();
      const c = document.createElement("canvas");
      const cx = c.getContext("2d");
      const texts = panelTexts();
      for (const [k, { i }] of sel.entries()) {
        const im = await loadFrame(frameFor(i));
        c.width = 480; c.height = Math.round(im.height * (480 / im.width));
        cx.drawImage(im, 0, 0, c.width, c.height);
        drawCaption(cx, texts[k] ?? "", c.width, c.height);
        const { data } = cx.getImageData(0, 0, c.width, c.height);
        const palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), c.width, c.height, { palette, delay: 1600 });
      }
      gif.finish();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([gif.bytes()], { type: "image/gif" }));
      a.download = fileName("gif");
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast("GIF failed — frames may still be uploading"); }
  });

  // ---------- actions ----------
  const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg));

  // Copying a /c/ link also renders the card to JPEG and stashes it in R2
  // (see /api/og-card) so the link unfurls with the exact image on the page.
  // Fire-and-forget: the clipboard never waits, and failures cost nothing —
  // the OG function falls back to the first line's raw frame.
  let ogUploaded = "";
  function uploadOgCard() {
    const u = currentUrl();
    const q = u.split("#")[0].split("?")[1] ?? "";
    if (!u.startsWith("/c/") || !q || q === ogUploaded) return;
    drawCard().then(() =>
      canvas?.toBlob((b) => {
        if (!b || b.size > 3_800_000 || !$("#img-note").hidden) return;
        fetch(`/api/og-card?show=${cfg.show}&item=${cfg.item}&${q}`, {
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: b,
        }).then((r) => { if (r.ok) ogUploaded = q; }).catch(() => {});
      }, "image/jpeg", 0.85)
    );
  }

  $("#copy-link").addEventListener("click", () => {
    copy(location.origin + currentUrl(), "Link copied");
    uploadOgCard();
  });
  $("#copy-yt").addEventListener("click", () =>
    copy(`https://youtu.be/${cfg.youtube}?t=${Math.floor(quoteSpan()[0])}`, "YouTube link copied"));
  $("#copy-quote").addEventListener("click", () => copy(quoteText(), "Quote copied"));

  // Save = publish: local stash first (never lost to a network hiccup), then
  // mint the public permalink — POST the state + rendered card to /api/save.
  // Content-addressed server-side: re-saving the same state returns the same
  // /s/ id, so this button is always safe to mash.
  $("#save-clip").addEventListener("click", async () => {
    const saved = JSON.parse(localStorage.getItem("savedClips") || "[]");
    const rec = {
      show: cfg.show, item: cfg.item, t: st.ctxStart, d: st.ctxEnd - st.ctxStart,
      title: pageTitle(), quote: quoteText().slice(0, 200), when: Date.now(),
    };
    saved.unshift(rec);
    localStorage.setItem("savedClips", JSON.stringify(saved.slice(0, 200)));

    const u = currentUrl();
    const q = u.split("#")[0].split("?")[1] ?? "";
    if (!u.startsWith("/c/") || !q) { toast("Saved on this device"); return; } // curated pages have permalinks already
    toast("Saving…");
    try {
      await drawCard();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob || !$("#img-note").hidden) throw new Error("no card");
      const resp = await fetch(`/api/save?show=${cfg.show}&item=${cfg.item}&${q}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      }).then((x) => x.json());
      if (!resp?.id) throw new Error(resp?.error ?? "save failed");
      rec.url = `${location.origin}/s/${resp.id}`;
      localStorage.setItem("savedClips", JSON.stringify(saved.slice(0, 200)));
      ogUploaded = q; // the card rode along — no need to re-send on copy-link
      await navigator.clipboard.writeText(rec.url).catch(() => {});
      toast("Saved — permalink copied");
    } catch {
      toast("Saved on this device — publishing failed");
    }
  });

  // ---------- keyboard ----------
  // ↑/↓ move the quote line · shift+↑/↓ grow the selection · ←/→ step the
  // frame (image) or scrub 5s (video) · shift+←/→ previous/next episode
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (document.activeElement?.isContentEditable) return;
    if (!document.getElementById("cmdk")?.hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape" && st.openStrip != null) { closeStrip(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (e.shiftKey) {
        // anchor stays put, the focus end moves — reverses to contract,
        // exactly like text selection
        anchor ??= selFirst();
        focusEnd = Math.max(0, Math.min(lines.length - 1, (focusEnd ?? selLast()) + dir));
        navigateTo(anchor, focusEnd, { play: false });
        scrollPanelTo(lineEls[focusEnd]);
      } else {
        const i = Math.max(0, Math.min(lines.length - 1, (dir === 1 ? selLast() : selFirst()) + dir));
        anchor = i;
        focusEnd = i;
        navigateTo(i, i, { play: false });
        scrollPanelTo(lineEls[i]);
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) {
        const idx = cfg.items.indexOf(cfg.item) + dir;
        if (idx >= 0 && idx < cfg.items.length) {
          e.preventDefault();
          location.href = `/c/${cfg.show}/${cfg.items[idx]}/`;
        }
      } else if (!$("#tab-image").hidden) {
        e.preventDefault();
        // arrows step the open carousel's line, else the first panel's frame
        const i = st.openStrip ?? selFirst();
        st.frameTs.set(i, clampT(frameFor(i) + dir * 0.5));
        markFilmstrip();
        drawCard();
        syncUrl();
        strips?.querySelector(".fgrid .on")
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        e.preventDefault();
        const t = player.raw()?.getCurrentTime?.() ?? st.ctxStart;
        player.seek(Math.max(st.ctxStart, Math.min(st.ctxEnd, t + dir * 5)), false);
      }
    }
  });

  // ---------- go ----------
  render(false);
  if (st.pendingTxt != null && imgText) imgText.value = st.pendingTxt; // ?txt= from a shared link
  history.replaceState({ sel: [...st.sel], cs: st.ctxStart, ce: st.ctxEnd }, "", location.href);
  applyTab();
  // no initial seek: seekTo() on a cued player starts playback. The play
  // button snaps into the clip window on its own.
  setTimeout(() => scrollPanelTo(lineEls[selFirst()], true), 100);
}
