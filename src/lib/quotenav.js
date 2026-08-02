// Quote navigator: the transcript is the UI. Click a line → that's the quote
// (a saved line becomes its clip page; anything else becomes a stateless /c/
// URL) — title, player window, links, and the image maker all follow. No
// separate editor page, no reload.
import { createClipPlayer, escapeHtml } from "./player.js";
import { fmtTime } from "./util.js";
import { frameUrl, lineFrameT } from "./config.js";

const PAD_S = 1.0, PAD_E = 1.5; // ad-hoc context padding around the quote

export async function initQuoteNav(cfg) {
  const $ = (s) => document.querySelector(s);
  const lines = cfg.lines; // [start, end, kind, speaker, text]
  const lineEls = [...document.querySelectorAll("#dialog .line")];

  const st = {
    selA: 0, selB: 0,           // selected line span (indices, inclusive)
    curated: null,               // adopted saved clip or null
    ctxStart: 0, ctxEnd: 10,     // player window
    frameTs: new Map(),          // per-line frame picks (line index → time)
    cols: 1,                     // panels per row for multi-line images
  };

  const clampT = (t) => Math.max(0, Math.min(cfg.duration ?? t, t));

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
      if (sel) [st.selA, st.selB] = sel;
    } else {
      const t = Math.max(0, parseFloat(params.get("t") ?? "0") || 0);
      const d = parseFloat(params.get("d") ?? "15") || 15;
      const qs = parseFloat(params.get("qs"));
      const qe = parseFloat(params.get("qe"));
      st.ctxStart = t; st.ctxEnd = Math.min(cfg.duration ?? t + d, t + d);
      const sel = Number.isFinite(qs) && Number.isFinite(qe)
        ? selFromRange(qs, qe)
        : selFromRange(t + 0.01, st.ctxEnd - 0.01);
      if (sel) [st.selA, st.selB] = sel;
      st.curated = matchCurated();
    }
    // shared image state: custom frames (one per selected line) + edited caption
    const f = params.get("f");
    if (f)
      f.split(",").forEach((v, k) => {
        const t = parseFloat(v);
        if (Number.isFinite(t) && st.selA + k <= st.selB) st.frameTs.set(st.selA + k, clampT(t));
      });
    const cols = parseInt(params.get("cols"), 10);
    if (cols === 2 || cols === 3) st.cols = cols;
    st.pendingTxt = params.get("txt");
  }

  function selLines() {
    return lines.slice(st.selA, st.selB + 1).map((l, k) => ({ l, i: st.selA + k }));
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
    if (st.selA !== st.selB) return null;
    const l = lines[st.selA];
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
    onTime: (t) => {
      // playback highlight only makes sense while the video is visible
      const imgMode = !document.getElementById("tab-image")?.hidden;
      for (const el of lineEls) {
        const active = !imgMode && +el.dataset.t <= t && t <= +el.dataset.e + 0.3;
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
    const txt = imgText?.value ?? "";
    if (txt && txt !== quoteText(false)) extras.set("txt", txt.slice(0, 300));
    const ex = extras.toString();
    if (st.curated) return `/clip/${cfg.show}/${st.curated.id}/${ex ? `?${ex}` : ""}${h}`;
    const [qs, qe] = quoteSpan();
    return `/c/${cfg.show}/${cfg.item}/?t=${r(st.ctxStart)}&d=${r(st.ctxEnd - st.ctxStart)}&qs=${r(qs)}&qe=${r(qe)}${ex ? `&${ex}` : ""}${h}`;
  }

  function render(push = true) {
    const sel = selLines();
    const first = sel[0];
    const title = st.curated
      ? st.curated.title
      : first ? (first.l[4].length > 64 ? first.l[4].slice(0, 61) + "…" : first.l[4]) : cfg.mediaTitle;

    $("#q-title-text").textContent = title;
    document.title = `"${title}" — ${cfg.mediaTitle} | DBZA Quotes`;

    for (const el of lineEls) {
      const i = +el.dataset.i;
      el.classList.toggle("in-quote", i >= st.selA && i <= st.selB);
      el.classList.toggle("main", i === st.selA);
    }
    player.setRange(st.ctxStart, st.ctxEnd);
    $("#img-gif").hidden = sel.length < 2;
    const cb = $("#cols-btn");
    if (cb) { cb.hidden = sel.length < 2; markCols(); }
    // multi-line: each panel gets its own caption box under its carousel,
    // so the single big textarea steps aside
    const tw = document.querySelector("#tab-image .textwrap");
    if (tw) tw.hidden = sel.length > 1;
    imgState.text = quoteText(false);
    if (imgText) imgText.value = imgState.text;
    if (push) history.pushState({ a: st.selA, b: st.selB, cs: st.ctxStart, ce: st.ctxEnd }, "", currentUrl());
    if (!$("#tab-image").hidden) { buildFilmstrip(); drawCard(); }
    placeHandles();
  }

  function navigateTo(a, b, { play = true } = {}) {
    st.selA = Math.min(a, b); st.selB = Math.max(a, b);
    st.curated = matchCurated();
    if (st.curated) {
      st.ctxStart = st.curated.start; st.ctxEnd = st.curated.end;
    } else {
      const [qs, qe] = quoteSpan();
      st.ctxStart = Math.max(0, qs - PAD_S);
      st.ctxEnd = Math.min(cfg.duration ?? qe + PAD_E, qe + PAD_E);
    }
    // frame picks survive grow/shrink but reset for lines that left the selection
    for (const k of [...st.frameTs.keys()])
      if (k < st.selA || k > st.selB) st.frameTs.delete(k);
    render();
    // don't start (hidden) playback while the image tab is up
    if (play && $("#tab-image").hidden)
      player.seek(quoteSpan()[0] - 0.2 < st.ctxStart ? st.ctxStart : quoteSpan()[0] - 0.2);
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
    if (e.shiftKey && anchor !== null) { focusEnd = i; navigateTo(anchor, i); }
    else { anchor = i; focusEnd = i; navigateTo(i, i); }
  });

  // Arrow handles at the selection edges: each edge can push outward (grow)
  // or pull inward (shrink, only when more than one line is selected).
  const CHEV_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>`;
  const CHEV_DN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
  function mkEdge(buttons) {
    const wrap = document.createElement("div");
    wrap.className = "ext-handle";
    for (const [svg, title, fn] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      b.innerHTML = svg;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
        anchor = st.selA;
        focusEnd = st.selB;
      });
      wrap.appendChild(b);
    }
    panel.appendChild(wrap);
    return wrap;
  }
  const reselect = (a, b) => navigateTo(a, b, { play: false });
  const edgeTop = mkEdge([
    [CHEV_UP, "Add the line above", () => st.selA > 0 && reselect(st.selA - 1, st.selB)],
    [CHEV_DN, "Remove the top line", () => st.selA < st.selB && reselect(st.selA + 1, st.selB)],
  ]);
  const edgeBot = mkEdge([
    [CHEV_UP, "Remove the bottom line", () => st.selB > st.selA && reselect(st.selA, st.selB - 1)],
    [CHEV_DN, "Add the line below", () => st.selB < lines.length - 1 && reselect(st.selA, st.selB + 1)],
  ]);
  function placeHandles() {
    const a = lineEls[st.selA], b = lineEls[st.selB];
    const multi = st.selA < st.selB;
    edgeTop.children[0].hidden = st.selA === 0;
    edgeTop.children[1].hidden = !multi;
    edgeBot.children[0].hidden = !multi;
    edgeBot.children[1].hidden = st.selB === lines.length - 1;
    edgeTop.style.display = a && (!edgeTop.children[0].hidden || !edgeTop.children[1].hidden) ? "" : "none";
    edgeBot.style.display = b && (!edgeBot.children[0].hidden || !edgeBot.children[1].hidden) ? "" : "none";
    if (a) edgeTop.style.top = `${a.offsetTop}px`;
    if (b) edgeBot.style.top = `${b.offsetTop + b.offsetHeight}px`;
  }

  window.addEventListener("popstate", (e) => {
    if (e.state) {
      st.selA = e.state.a; st.selB = e.state.b;
      st.ctxStart = e.state.cs; st.ctxEnd = e.state.ce;
      st.curated = matchCurated();
      for (const k of [...st.frameTs.keys()])
        if (k < st.selA || k > st.selB) st.frameTs.delete(k);
      render(false);
    }
  });

  // ---------- image/video toggle (hash-driven so #video deep-links) ----------
  // image is the default; #video opts into the player
  const toggle = $("#tab-toggle");
  function applyTab() {
    const img = location.hash !== "#video";
    $("#tab-video").hidden = img;
    $("#tab-image").hidden = !img;
    if (toggle) {
      toggle.href = img ? "#video" : "#image";
      toggle.title = img ? "Watch the clip" : "Back to the image";
      $("#tt-video").hidden = !img;
      $("#tt-image").hidden = img;
    }
    if (img) { player.pause(); buildFilmstrip(); drawCard(); }
    else {
      // to video: line the player up with the clip window. Only seek a player
      // that has already been started — seekTo() on a freshly-cued player
      // kicks off playback, which is exactly what we don't want on load.
      const yt = player.raw();
      const started = [1, 2, 3].includes(yt?.getPlayerState?.());
      const t = yt?.getCurrentTime?.() ?? null;
      if (started && t !== null && (t < st.ctxStart - 0.5 || t > st.ctxEnd))
        player.seek(st.ctxStart, false);
    }
  }
  window.addEventListener("hashchange", applyTab);

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

  function drawCaption(c, text, W, H) {
    if (!text.trim()) return;
    const size = Math.max(20, Math.round(W / 21));
    c.font = `bold ${size}px "Arial", sans-serif`;
    c.textAlign = "center";
    c.lineJoin = "round";
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
    let y = H - show.length * lh - H * 0.035 + size;
    for (const ln of show) {
      c.strokeStyle = "black"; c.lineWidth = Math.max(3, size / 6);
      c.strokeText(ln, W / 2, y);
      c.fillStyle = "white";
      c.fillText(ln, W / 2, y);
      y += lh;
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
      $("#img-note").hidden = true;
    } catch {
      canvas.width = 640; canvas.height = 360;
      ctx2d.fillStyle = "#141821";
      ctx2d.fillRect(0, 0, 640, 360);
      drawCaption(ctx2d, imgText?.value ?? imgState.text, 640, 360);
      $("#img-note").hidden = false;
    }
  }

  // columns button: one overlay control that cycles 1 → 2 → 3 panels per row,
  // its icon mirroring the current layout
  const colsBtn = $("#cols-btn");
  function markCols() {
    for (const s of colsBtn?.children ?? []) s.hidden = +s.dataset.cols !== st.cols;
    if (colsBtn) colsBtn.title = `${st.cols} per row — click to switch`;
  }
  colsBtn?.addEventListener("click", () => {
    st.cols = (st.cols % 3) + 1;
    markCols();
    drawCard();
    syncUrl();
  });

  // Frame carousels: one strip per selected line — click to pick that panel's
  // frame. A single line looks exactly like the old filmstrip (no label).
  const strips = $("#fstrips");
  function buildFilmstrip() {
    if (!strips) return;
    strips.innerHTML = "";
    const sel = selLines();
    const pad = sel.length > 1 ? 2 : 3;
    const texts = panelTexts();
    for (const [k, { l, i }] of sel.entries()) {
      if (sel.length > 1) {
        const lab = document.createElement("div");
        lab.className = "fs-label";
        const snippet = l[2] !== "dialog" ? `[${l[4]}]` : l[4];
        lab.innerHTML = `${l[3] && l[2] === "dialog" ? `<span class="who">${escapeHtml(l[3])}</span> ` : ""}${escapeHtml(snippet.length > 60 ? snippet.slice(0, 57) + "…" : snippet)}`;
        strips.appendChild(lab);
      }
      const wrap = document.createElement("div");
      wrap.className = "fstrip-wrap";
      const strip = document.createElement("div");
      strip.className = "fstrip";
      strip.dataset.line = i;
      strip.title = "Pick a different frame";
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
          markFilmstrip();
          drawCard();
          syncUrl();
        });
        strip.appendChild(im);
      }
      for (const [cls, txt, dir] of [["prev", "‹", -1], ["next", "›", 1]]) {
        const b = document.createElement("button");
        b.className = `fs-nav ${cls}`;
        b.textContent = txt;
        b.title = dir < 0 ? "Earlier frames" : "Later frames";
        b.addEventListener("click", () =>
          strip.scrollBy({ left: dir * strip.clientWidth * 0.7, behavior: "smooth" }));
        wrap.appendChild(b);
      }
      wrap.appendChild(strip);
      // plain mouse wheel scrolls the strip horizontally
      strip.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          strip.scrollLeft += e.deltaY;
        }
      }, { passive: false });
      strips.appendChild(wrap);
      if (sel.length > 1) {
        const ta = document.createElement("textarea");
        ta.className = "fs-text";
        ta.rows = 1;
        ta.dataset.line = i;
        ta.title = "This panel's caption — your words";
        ta.value = texts[k] ?? "";
        ta.addEventListener("input", onPanelText);
        strips.appendChild(ta);
      }
    }
    markFilmstrip();
    for (const strip of strips.querySelectorAll(".fstrip")) {
      const cur = strip.querySelector(".on");
      if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2;
    }
  }
  function markFilmstrip() {
    if (!strips) return;
    for (const strip of strips.querySelectorAll(".fstrip")) {
      const t = frameFor(+strip.dataset.line);
      for (const el of strip.children) el.classList.toggle("on", Math.abs(+el.dataset.t - t) < 0.26);
    }
  }

  // keep the address bar in sync with customizations (replace, don't push)
  function syncUrl() {
    history.replaceState({ a: st.selA, b: st.selB, cs: st.ctxStart, ce: st.ctxEnd }, "", currentUrl());
  }
  let txtTimer;
  imgText?.addEventListener("input", () => {
    drawCard();
    clearTimeout(txtTimer);
    txtTimer = setTimeout(syncUrl, 350);
  });
  // Per-panel caption boxes write back into the (hidden) main textarea, which
  // stays the single source of truth: line k of its value captions panel k, so
  // panelTexts(), the ?txt= param, and the GIF all keep working unchanged.
  // Newlines only mean something in the last box — elsewhere they'd shift the
  // line↔panel mapping, so they flatten to spaces.
  function onPanelText() {
    if (!imgText) return;
    const boxes = [...strips.querySelectorAll(".fs-text")];
    imgText.value = boxes
      .map((b, k) => (k < boxes.length - 1 ? b.value.replace(/\n/g, " ") : b.value))
      .join("\n");
    drawCard();
    clearTimeout(txtTimer);
    txtTimer = setTimeout(syncUrl, 350);
  }

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
      title: $("#q-title-text").textContent, quote: quoteText().slice(0, 200), when: Date.now(),
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

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (e.shiftKey) {
        // anchor stays put, the focus end moves — reverses to contract,
        // exactly like text selection
        anchor ??= st.selA;
        focusEnd = Math.max(0, Math.min(lines.length - 1, (focusEnd ?? st.selB) + dir));
        navigateTo(anchor, focusEnd, { play: false });
        scrollPanelTo(lineEls[focusEnd]);
      } else {
        const i = Math.max(0, Math.min(lines.length - 1, (dir === 1 ? st.selB : st.selA) + dir));
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
        const i = st.selA; // multi-panel: arrows step the first panel's frame
        st.frameTs.set(i, clampT(frameFor(i) + dir * 0.5));
        markFilmstrip();
        drawCard();
        syncUrl();
        strips?.querySelector(`.fstrip[data-line="${i}"] .on`)
          ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
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
  history.replaceState({ a: st.selA, b: st.selB, cs: st.ctxStart, ce: st.ctxEnd }, "", location.href);
  applyTab();
  // no initial seek: seekTo() on a cued player starts playback. The play
  // button snaps into the clip window on its own.
  setTimeout(() => scrollPanelTo(lineEls[st.selA], true), 100);
}
