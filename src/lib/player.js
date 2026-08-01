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

export async function createClipPlayer({ mountId, youtube, lines, captionEl, controlsEl, onTime, start = 0, end = null }) {
  await loadApi();
  const state = { start, end, player: null, scrubbing: false };

  await new Promise((ready) => {
    state.player = new window.YT.Player(mountId, {
      videoId: youtube,
      playerVars: {
        rel: 0, modestbranding: 1, cc_load_policy: 1, playsinline: 1,
        controls: 0, iv_load_policy: 3, start: Math.floor(start),
      },
      events: { onReady: ready },
    });
  });

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
    playBtn.addEventListener("click", () => {
      const p = state.player;
      if (p.getPlayerState() === 1) p.pauseVideo();
      else {
        const t = p.getCurrentTime();
        if (state.end != null && (t < state.start - 0.5 || t >= state.end - 0.1)) p.seekTo(state.start, true);
        p.playVideo();
      }
    });
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
    const playing = p.getPlayerState?.() === 1;
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
      timeLabel.textContent = `${fmt(Math.max(0, t - state.start))} / ${fmt((state.end ?? t) - state.start)}`;
    }
    if (state.end != null && playing && t >= state.end && !state.scrubbing) p.pauseVideo();
    onTime?.(t);
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
  };
}

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
