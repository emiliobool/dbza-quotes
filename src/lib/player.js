// YouTube IFrame player with a custom control bar scoped to the clip range.
// YouTube's native controls are hidden (controls:0); our bar drives the player
// via the API: play/pause + a scrubber that only spans [start, end]. A caption
// bar is synced from our transcript by polling getCurrentTime().

let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export async function createClipPlayer({ mountId, youtube, lines, captionEl, controlsEl, shieldEl, posterUrl, onTime, start = 0, end = null, loop = true }) {
  await loadApi();
  const state = { start, end, loop, player: null, scrubbing: false };

  await new Promise((ready) => {
    state.player = new window.YT.Player(mountId, {
      videoId: youtube,
      playerVars: {
        rel: 0, modestbranding: 1, playsinline: 1, disablekb: 1, fs: 0,
        controls: 0, iv_load_policy: 3, start: Math.floor(start),
      },
      events: {
        onReady: ready,
        // our transcript captions are overlaid on the video; keep YouTube's own
        // CC off even for viewers whose stored YT prefs force it on. The module
        // loads lazily, so unload whenever it announces itself (onApiChange).
        onApiChange: (e) => {
          try { e.target.unloadModule("captions"); e.target.unloadModule("cc"); } catch {}
        },
      },
    });
  });

  function togglePlay() {
    const p = state.player;
    if (p.getPlayerState() === 1) p.pauseVideo();
    else {
      const t = p.getCurrentTime();
      if (state.end != null && (t < state.start - 0.5 || t >= state.end - 0.1)) p.seekTo(state.start, true);
      p.playVideo();
    }
  }

  // click shield: the iframe ignores pointer events (so YouTube never shows its
  // hover UI); this layer takes the clicks and hides paused/idle YT overlays
  // ("More videos" wall, title card) behind a frame poster.
  if (shieldEl) {
    shieldEl.addEventListener("click", togglePlay);
    if (posterUrl) {
      state.posterT = start;
      shieldEl.style.setProperty("--poster", `url("${posterUrl(start)}")`);
    }
    shieldEl.classList.add("idle");
  }

  // control bar
  let playBtn, scrub, timeLabel;
  if (controlsEl) {
    controlsEl.innerHTML = `
      <button class="play-btn" title="Play / pause clip">▶</button>
      <input class="scrub" type="range" step="0.1" title="Seek within the clip">
      <span class="time-label"></span>`;
    playBtn = controlsEl.querySelector(".play-btn");
    scrub = controlsEl.querySelector(".scrub");
    timeLabel = controlsEl.querySelector(".time-label");
    playBtn.addEventListener("click", togglePlay);
    scrub.addEventListener("input", () => {
      state.scrubbing = true;
      paintScrub();
      state.player.seekTo(parseFloat(scrub.value), true);
    });
    scrub.addEventListener("change", () => { state.scrubbing = false; });
  }

  const dialog = lines.filter((l) => l[2] === "dialog");
  function lineAt(t) {
    let hit = null;
    for (const l of dialog) {
      if (l[0] <= t && t <= l[1] + 0.3) hit = l;
      if (l[0] > t) break;
    }
    return hit;
  }

  // paints the filled portion of the scrubber track (--pct drives a CSS gradient)
  function paintScrub() {
    const span = (+scrub.max || 0) - (+scrub.min || 0);
    const pct = span > 0 ? ((+scrub.value - +scrub.min) / span) * 100 : 0;
    scrub.style.setProperty("--pct", `${Math.min(100, Math.max(0, pct))}%`);
  }

  function syncControls() {
    if (!controlsEl || state.end == null) return;
    scrub.min = state.start;
    scrub.max = state.end;
    timeLabel.textContent = fmt(state.end - state.start) + "s";
    paintScrub();
  }

  function tick() {
    const p = state.player;
    if (!p?.getCurrentTime) return;
    const t = p.getCurrentTime();
    const st = p.getPlayerState?.();
    const playing = st === 1;
    if (shieldEl) {
      const idle = st !== 1 && st !== 3; // paused/cued/ended — cover YT's overlays
      if (idle && posterUrl && Math.abs(t - (state.posterT ?? -9)) > 0.3) {
        state.posterT = t; // follows the scrubber while paused
        shieldEl.style.setProperty("--poster", `url("${posterUrl(t)}")`);
      }
      shieldEl.classList.toggle("idle", idle);
    }
    if (captionEl) {
      const l = lineAt(t);
      captionEl.innerHTML = l
        ? `${l[3] ? `<span class="speaker">${l[3]}:</span> ` : ""}${escapeHtml(l[4])}`
        : "";
    }
    if (controlsEl) {
      playBtn.textContent = playing ? "❚❚" : "▶";
      if (!state.scrubbing) {
        scrub.value = Math.min(Math.max(t, state.start), state.end ?? t);
        paintScrub();
      }
      const span = (state.end ?? t) - state.start;
      timeLabel.textContent = `${fmt(Math.min(span, Math.max(0, t - state.start)))} / ${fmt(span)}`;
    }
    if (state.end != null && playing && t >= state.end && !state.scrubbing) {
      if (state.loop) p.seekTo(state.start, true);
      else p.pauseVideo();
    }
    onTime?.(t, playing);
  }
  setInterval(tick, 250);
  syncControls();

  return {
    raw: () => state.player,
    setRange(s, e) { state.start = s; state.end = e; syncControls(); },
    playClip() {
      state.player.seekTo(state.start, true);
      state.player.playVideo();
    },
    seek(t, play = true) {
      state.player.seekTo(t, true);
      if (play) state.player.playVideo();
    },
    pause() { state.player.pauseVideo?.(); },
  };
}

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
