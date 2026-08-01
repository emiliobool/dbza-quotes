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
    frameT: 0,                   // image tab frame time
  };

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
      if (l[2] !== "dialog") return;
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
    st.frameT = defaultFrameT();
  }

  function selLines() {
    return lines.slice(st.selA, st.selB + 1).map((l, k) => ({ l, i: st.selA + k }))
      .filter((x) => x.l[2] === "dialog");
  }
  function quoteSpan() {
    const sel = selLines();
    if (!sel.length) return [st.ctxStart, st.ctxEnd];
    return [sel[0].l[0], sel[sel.length - 1].l[1]];
  }
  function defaultFrameT() {
    const sel = selLines();
    if (!sel.length) return (st.ctxStart + st.ctxEnd) / 2;
    return lineFrameT(sel[0].l, sel[0].i, cfg.overrides);
  }
  function quoteText(withSpeakers = true) {
    return selLines()
      .map(({ l }) => (withSpeakers && l[3] ? `${l[3]}: ${l[4]}` : l[4]))
      .join("\n");
  }
  function matchCurated() {
    if (st.selA !== st.selB) return null;
    const l = lines[st.selA];
    const mid = (l[0] + l[1]) / 2;
    return cfg.itemClips.find((c) => c.qStart <= mid && mid <= c.qEnd) ?? null;
  }

  // ---------- player ----------
  const player = await createClipPlayer({
    mountId: "yt-player",
    youtube: cfg.youtube,
    lines,
    captionEl: $("#caption"),
    controlsEl: $("#controls"),
    start: 0, end: 10, loop: true,
    onTime: (t) => {
      for (const el of lineEls) {
        const active = +el.dataset.t <= t && t <= +el.dataset.e + 0.3;
        if (active && !el.classList.contains("active")) scrollPanelTo(el);
        el.classList.toggle("active", active);
      }
    },
  });

  // ---------- render ----------
  function currentUrl() {
    if (st.curated) return `/clip/${cfg.show}/${st.curated.id}/`;
    const [qs, qe] = quoteSpan();
    const r = (x) => Math.round(x * 10) / 10;
    return `/c/${cfg.show}/${cfg.item}/?t=${r(st.ctxStart)}&d=${r(st.ctxEnd - st.ctxStart)}&qs=${r(qs)}&qe=${r(qe)}`;
  }

  function render(push = true) {
    const sel = selLines();
    const first = sel[0];
    const title = st.curated
      ? st.curated.title
      : first ? (first.l[4].length > 64 ? first.l[4].slice(0, 61) + "…" : first.l[4]) : cfg.mediaTitle;
    const speaker = st.curated?.speaker ?? first?.l[3] ?? "";

    $("#q-title-text").textContent = title;
    $("#q-speaker").textContent = speaker;
    $("#q-speaker-sep").style.display = speaker ? "" : "none";
    $("#q-time").textContent = fmtTime(quoteSpan()[0]);
    document.title = `"${title}" — ${cfg.mediaTitle} | DBZA Quotes`;

    for (const el of lineEls) {
      const i = +el.dataset.i;
      el.classList.toggle("in-quote", i >= st.selA && i <= st.selB && lines[i][2] === "dialog");
      el.classList.toggle("in-range", lines[i][1] > st.ctxStart && lines[i][0] < st.ctxEnd);
    }
    player.setRange(st.ctxStart, st.ctxEnd);
    $("#img-gif").hidden = sel.length < 2;
    if (push) history.pushState({ a: st.selA, b: st.selB, cs: st.ctxStart, ce: st.ctxEnd }, "", currentUrl());
    imgState.text = quoteText(false);
    if (imgText) imgText.value = imgState.text;
    if (!$("#tab-image").hidden) drawCard();
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
    st.frameT = defaultFrameT();
    render();
    if (play) player.seek(quoteSpan()[0] - 0.2 < st.ctxStart ? st.ctxStart : quoteSpan()[0] - 0.2);
  }

  // ---------- transcript interaction ----------
  let anchor = null;
  $("#dialog").addEventListener("click", (e) => {
    const el = e.target.closest(".line");
    if (!el) return;
    const i = +el.dataset.i;
    if (lines[i][2] !== "dialog") { player.seek(lines[i][0]); return; }
    if (e.shiftKey && anchor !== null) navigateTo(anchor, i);
    else { anchor = i; navigateTo(i, i); }
  });

  window.addEventListener("popstate", (e) => {
    if (e.state) {
      st.selA = e.state.a; st.selB = e.state.b;
      st.ctxStart = e.state.cs; st.ctxEnd = e.state.ce;
      st.curated = matchCurated();
      st.frameT = defaultFrameT();
      render(false);
    }
  });

  // ---------- tabs ----------
  const tabs = document.querySelectorAll(".mtab");
  tabs.forEach((b) =>
    b.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.toggle("on", x === b));
      const img = b.dataset.tab === "image";
      $("#tab-video").hidden = img;
      $("#tab-image").hidden = !img;
      if (img) { player.pause(); drawCard(); }
    })
  );

  // ---------- image maker ----------
  const canvas = $("#imgcanvas");
  const ctx2d = canvas?.getContext("2d");
  const imgText = $("#imgtext");
  const imgState = { text: "" };
  const frameCache = new Map();

  function loadFrame(t) {
    const url = frameUrl(cfg.item, Math.min(t, cfg.duration ?? t));
    if (!frameCache.has(url)) {
      frameCache.set(url, new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      }));
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

  async function drawCard() {
    if (!ctx2d) return;
    $("#flabel").textContent = fmtTime(st.frameT);
    try {
      const im = await loadFrame(st.frameT);
      canvas.width = 640;
      canvas.height = Math.round(im.height * (640 / im.width));
      ctx2d.drawImage(im, 0, 0, canvas.width, canvas.height);
      drawCaption(ctx2d, imgText?.value ?? imgState.text, canvas.width, canvas.height);
      $("#img-note").hidden = true;
    } catch {
      canvas.width = 640; canvas.height = 360;
      ctx2d.fillStyle = "#141821";
      ctx2d.fillRect(0, 0, 640, 360);
      drawCaption(ctx2d, imgText?.value ?? imgState.text, 640, 360);
      $("#img-note").hidden = false;
    }
  }

  $("#fprev")?.addEventListener("click", () => { st.frameT = Math.max(0, st.frameT - 0.5); drawCard(); });
  $("#fnext")?.addEventListener("click", () => { st.frameT = Math.min(cfg.duration ?? Infinity, st.frameT + 0.5); drawCard(); });
  imgText?.addEventListener("input", () => drawCard());

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
      for (const { l, i } of sel) {
        const im = await loadFrame(lineFrameT(l, i, cfg.overrides));
        c.width = 480; c.height = Math.round(im.height * (480 / im.width));
        cx.drawImage(im, 0, 0, c.width, c.height);
        drawCaption(cx, l[4], c.width, c.height);
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
  $("#copy-link").addEventListener("click", () => copy(location.origin + currentUrl(), "Link copied"));
  $("#copy-yt").addEventListener("click", () =>
    copy(`https://youtu.be/${cfg.youtube}?t=${Math.floor(quoteSpan()[0])}`, "YouTube link copied"));
  $("#copy-quote").addEventListener("click", () => copy(quoteText(), "Quote copied"));

  $("#save-clip").addEventListener("click", () => {
    const saved = JSON.parse(localStorage.getItem("savedClips") || "[]");
    saved.unshift({
      show: cfg.show, item: cfg.item, t: st.ctxStart, d: st.ctxEnd - st.ctxStart,
      title: $("#q-title-text").textContent, quote: quoteText().slice(0, 200), when: Date.now(),
    });
    localStorage.setItem("savedClips", JSON.stringify(saved.slice(0, 200)));
    toast("Saved on this device");
  });

  $("#submit-clip").addEventListener("click", async () => {
    const note = prompt("Suggest this quote for the public list?\nOptional note:");
    if (note === null) return;
    try {
      const [qs, qe] = quoteSpan();
      const r = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "clip_suggestion",
          payload: { show: cfg.show, item: cfg.item, t: st.ctxStart, d: st.ctxEnd - st.ctxStart,
            qs, qe, note, quote: quoteText().slice(0, 500) },
        }),
      });
      toast(r.ok ? "Submitted — thanks!" : "Submissions are closed right now");
    } catch { toast("Submissions are unavailable right now"); }
  });

  // ---------- go ----------
  initState();
  render(false);
  history.replaceState({ a: st.selA, b: st.selB, cs: st.ctxStart, ce: st.ctxEnd }, "", location.href);
  player.seek(st.ctxStart, false);
  setTimeout(() => scrollPanelTo(lineEls[st.selA], true), 100);
}
