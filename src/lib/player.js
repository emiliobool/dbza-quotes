// YouTube IFrame player + synced captions from our transcript data.
// Loads the IFrame API on demand; polls getCurrentTime() to drive a caption bar
// and clip-range stop behavior. Used by the clip editor and curated clip pages.

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

export async function createClipPlayer({ mountId, youtube, lines, captionEl, onTime, start = 0 }) {
  await loadApi();
  const state = { start, end: null, loopStop: true, player: null, timer: null };

  // resolve only once the player is ready — before onReady, methods like
  // seekTo/playVideo don't exist on the instance yet
  await new Promise((ready) => {
    state.player = new window.YT.Player(mountId, {
      videoId: youtube,
      playerVars: {
        rel: 0, modestbranding: 1, cc_load_policy: 1, playsinline: 1,
        start: Math.floor(start),
      },
      events: { onReady: ready },
    });
  });

  const dialog = lines.filter((l) => l[2] === "dialog");
  function lineAt(t) {
    // last dialog line whose start <= t and end+0.3 >= t
    let hit = null;
    for (const l of dialog) {
      if (l[0] <= t && t <= l[1] + 0.3) hit = l;
      if (l[0] > t) break;
    }
    return hit;
  }

  function tick() {
    const p = state.player;
    if (!p?.getCurrentTime) return;
    const t = p.getCurrentTime();
    if (captionEl) {
      const l = lineAt(t);
      captionEl.innerHTML = l
        ? `${l[3] ? `<span class="speaker">${l[3]}:</span> ` : ""}${escapeHtml(l[4])}`
        : "";
    }
    if (state.loopStop && state.end != null && t >= state.end && p.getPlayerState?.() === 1) {
      p.pauseVideo();
    }
    onTime?.(t);
  }
  state.timer = setInterval(tick, 250);

  return {
    raw: () => state.player,
    setRange(start, end) { state.start = start; state.end = end; },
    playClip() {
      state.player.seekTo(state.start, true);
      state.player.playVideo();
    },
    seek(t, play = true) {
      state.player.seekTo(t, true);
      if (play) state.player.playVideo();
    },
    setLoopStop(v) { state.loopStop = v; },
  };
}

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
