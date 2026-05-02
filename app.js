const STATE_KEY = "arisongs_player_v1";
const COUNTS_KEY = "papoule_listen_counts_v1";
const THRESHOLD_SEC = 15;

/** @type {{ tracks: Array<Record<string, unknown>> }} */
let data = { tracks: [] };
let idx = 0;
let saveTimer = null;
let lastTickTime = null;
let listenedSec = 0;
let countedThisRound = false;
let lastPositionSyncMs = 0;

const audio = document.getElementById("audio");
const cover = document.getElementById("cover");
const npTitle = document.getElementById("np-title");
const npArtist = document.getElementById("np-artist");
const tCur = document.getElementById("t-cur");
const tEnd = document.getElementById("t-end");
const seek = document.getElementById("seek");
const btnPlay = document.getElementById("btn-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnLyricsNow = document.getElementById("btn-lyrics-now");
const playlistEl = document.getElementById("playlist");
const modalRoot = document.getElementById("modal-root");
const modalTitle = document.getElementById("modal-title");
const modalArtist = document.getElementById("modal-artist");
const modalLyrics = document.getElementById("modal-lyrics");
const modalClose = document.getElementById("modal-close");

function paintSeekBar() {
  const d = audio.duration;
  const c = audio.currentTime;
  const pct =
    Number.isFinite(d) && d > 0 ? Math.min(100, Math.max(0, (c / d) * 100)) : 0;
  seek.style.setProperty("--seek-pct", `${pct}%`);
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Кодує кожен сегмент шляху. NFC перед encode — інакше NFD-імена (напр. «Мой» = и + combining)
 * дають інший %XX ніж файл на GitHub Pages → 404 лише для першого треку.
 */
function assetUrl(rel) {
  const root = new URL("./", window.location.href);
  const path = String(rel)
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg.normalize("NFC")))
    .join("/");
  return path ? new URL(path, root).href : root.href;
}

function loadCounts() {
  try {
    const raw = localStorage.getItem(COUNTS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function saveCounts(map) {
  localStorage.setItem(COUNTS_KEY, JSON.stringify(map));
}

function bumpCount(id) {
  const m = loadCounts();
  m[id] = (m[id] || 0) + 1;
  saveCounts(m);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStateSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const st = {
      idx,
      t: audio.currentTime || 0,
      ts: Date.now(),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  }, 400);
}

function resetListenMeter() {
  listenedSec = 0;
  countedThisRound = false;
  lastTickTime = null;
}

function onTimeUpdateMeter() {
  if (audio.paused) return;
  const ct = audio.currentTime;
  if (lastTickTime == null) {
    lastTickTime = ct;
    return;
  }
  const d = ct - lastTickTime;
  lastTickTime = ct;
  if (d <= 0 || d > 2) return;
  listenedSec += d;
  if (!countedThisRound && listenedSec >= THRESHOLD_SEC) {
    const t = currentTrack();
    if (t) bumpCount(t.id);
    countedThisRound = true;
  }
}

function currentTrack() {
  return data.tracks[idx] || null;
}

/** idx === 0 не можна перевіряти як if (st.idx). Підтримуємо idx з localStorage як число або "0". */
function validSavedIdx(st) {
  if (!st) return false;
  const i = Number(st.idx);
  if (!Number.isInteger(i)) return false;
  if (i < 0 || i >= data.tracks.length) return false;
  return Boolean(data.tracks[i]);
}

function setUiForTrack(track, { withCover = true } = {}) {
  if (!track) return;
  npTitle.textContent = track.title;
  npArtist.textContent = track.artist || "";
  document.title = `${track.title} — AriSongs`;
  tEnd.textContent = fmtTime(track.durationSec || 0);
  if (withCover) {
    if (track.cover) {
      cover.removeAttribute("hidden");
      cover.src = assetUrl(track.cover);
      cover.alt = track.title;
    } else {
      cover.removeAttribute("src");
      cover.alt = "";
    }
  }
  syncMediaSession(track);
}

function syncMediaSession(tr) {
  if (!tr || !("mediaSession" in navigator)) return;
  const art = [];
  if (tr.cover) {
    art.push({ src: assetUrl(tr.cover), sizes: "512x512", type: "image/jpeg" });
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title,
      artist: tr.artist || "",
      album: "AriSongs",
      artwork: art,
    });
  } catch (_) {
    /* ignore */
  }
}

function syncPlaybackState() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch (_) {
    /* ignore */
  }
}

/** iPhone/iPad: не оновлюємо position state — інакше WebKit часто лишає лише seek ±10 с замість треку. */
function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

function syncMediaSessionPosition() {
  if (!("mediaSession" in navigator)) return;
  /* Не оновлюємо position на iOS — інакше замість |◀◀ ▶▶| лишаються лише «10 с» (обмеження WebKit). */
  if (isAppleTouchDevice()) return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(d, Math.max(0, audio.currentTime || 0)),
    });
  } catch (_) {
    /* ignore */
  }
}

function registerMediaSessionActionHandlers() {
  if (!("mediaSession" in navigator)) return;
  const apple = isAppleTouchDevice();
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      audio.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      prevTrack();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      nextTrack();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      audio.pause();
      audio.currentTime = 0;
    });
    /*
     * Якщо зареєструвати seekbackward/seekforward, iOS показує саме ±10 с, а не |◀◀ ▶▶|.
     * На Apple явно знімаємо seek*, лишаємо лише previoustrack/nexttrack.
     */
    try {
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    } catch (_) {
      /* ignore */
    }
    if (apple) {
      try {
        navigator.mediaSession.setActionHandler("seekto", null);
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Запуск відтворення після зміни src.
 * Спочатку реєструємо слухачі, потім load() — інакше loadedmetadata встигає вистрілити до підписки (перший трек мовчить).
 * Негайний play() після load() зберігає ланцюг user gesture на iOS.
 */
function playWhenAudioReady(resetTime) {
  let settled = false;
  const cleanup = () => {
    audio.removeEventListener("loadedmetadata", tryPlay);
    audio.removeEventListener("canplay", tryPlay);
    clearTimeout(fallbackTimer);
  };
  const onPlayed = () => {
    if (settled) return;
    settled = true;
    cleanup();
    syncPlaybackState();
    syncMediaSessionPosition();
  };
  const tryPlay = () => {
    if (settled) return;
    if (resetTime) audio.currentTime = 0;
    const p = audio.play();
    if (p !== undefined) {
      p.then(onPlayed).catch(() => {});
    } else {
      onPlayed();
    }
  };
  audio.addEventListener("loadedmetadata", tryPlay);
  audio.addEventListener("canplay", tryPlay);
  const fallbackTimer = setTimeout(() => tryPlay(), 2200);
  audio.load();
  tryPlay();
}

const PLAYING_ICON_SVG = `<svg class="track__thumb-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

function renderPlaylist() {
  playlistEl.innerHTML = "";
  data.tracks.forEach((tr, i) => {
    const row = document.createElement("div");
    row.className = "track" + (i === idx ? " track--active" : "");
    row.setAttribute("role", "listitem");
    row.dataset.index = String(i);

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "track__thumb-wrap";
    if (!tr.cover) {
      thumbWrap.classList.add("track__thumb-wrap--empty");
    } else {
      const thumb = document.createElement("img");
      thumb.className = "track__thumb";
      thumb.alt = "";
      thumb.src = assetUrl(tr.cover);
      thumbWrap.appendChild(thumb);
    }
    const iconLayer = document.createElement("span");
    iconLayer.className = "track__thumb-icon";
    iconLayer.setAttribute("aria-hidden", "true");
    iconLayer.innerHTML = PLAYING_ICON_SVG;
    thumbWrap.appendChild(iconLayer);

    const main = document.createElement("div");
    main.className = "track__main";
    const t = document.createElement("div");
    t.className = "track__title";
    t.textContent = tr.title;
    const a = document.createElement("div");
    a.className = "track__artist";
    a.textContent = tr.artist || "";
    main.appendChild(t);
    main.appendChild(a);

    const dur = document.createElement("div");
    dur.className = "track__dur";
    dur.textContent = fmtTime(tr.durationSec || 0);

    row.appendChild(thumbWrap);
    row.appendChild(main);
    row.appendChild(dur);

    row.addEventListener("click", () => {
      if (i === idx) {
        togglePlay();
        return;
      }
      playIndex(i);
    });

    playlistEl.appendChild(row);
  });
}

function openLyrics(track) {
  modalRoot.dataset.trackId = track.id;
  modalTitle.textContent = track.title;
  modalArtist.textContent = track.artist || "";
  const text = (track.lyrics || "").trim();
  modalLyrics.textContent = text || "Тексту ще немає в тегах файлу.";
  modalRoot.classList.remove("hidden");
}

function closeLyrics() {
  delete modalRoot.dataset.trackId;
  modalRoot.classList.add("hidden");
}

function loadTrackSource(track) {
  audio.src = assetUrl(track.file);
}

function playIndex(i) {
  const tracks = data.tracks;
  if (!tracks.length) return;
  idx = (i + tracks.length) % tracks.length;
  const tr = tracks[idx];
  resetListenMeter();
  setUiForTrack(tr);
  loadTrackSource(tr);
  renderPlaylist();
  playWhenAudioReady(true);
}

function nextTrack() {
  playIndex(idx + 1);
}

function prevTrack() {
  playIndex(idx - 1);
}

function togglePlay() {
  const tr = currentTrack();
  if (!tr) return;
  const has = Boolean(audio.src || audio.currentSrc);
  if (!has) {
    loadTrackSource(tr);
    playWhenAudioReady(false);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

const ICON_PLAY = `<svg class="dock-icon dock-icon--lg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg class="dock-icon dock-icon--lg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

function updatePlayButton() {
  const hasMedia = Boolean(audio.src || audio.currentSrc);
  const on = !audio.paused && hasMedia;
  btnPlay.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
  btnPlay.setAttribute("aria-label", on ? "Пауза" : "Відтворити");
}

/** iOS Safari часто ігнорує лише viewport user-scalable=no — блокуємо pinch-zoom (gesture*). */
function preventPinchZoom() {
  const block = (e) => {
    e.preventDefault();
  };
  const opts = { passive: false };
  document.addEventListener("gesturestart", block, opts);
  document.addEventListener("gesturechange", block, opts);
  document.addEventListener("gestureend", block, opts);
}

function wire() {
  preventPinchZoom();
  registerMediaSessionActionHandlers();

  audio.addEventListener(
    "playing",
    () => {
      const run = () => {
        registerMediaSessionActionHandlers();
        if (!("mediaSession" in navigator)) return;
        if (isAppleTouchDevice()) {
          try {
            navigator.mediaSession.setPositionState(null);
          } catch (_) {
            /* ignore */
          }
        }
      };
      run();
      /* iOS: повторна реєстрація в наступному тіку часто потрібна, щоб з’явились track-кнопки. */
      if (isAppleTouchDevice()) {
        setTimeout(run, 0);
        setTimeout(run, 120);
      }
    },
    { passive: true }
  );

  btnPlay.addEventListener("click", () => {
    const has = Boolean(audio.src || audio.currentSrc);
    if (!has) {
      const st = loadState();
      if (validSavedIdx(st)) {
        idx = st.idx;
      }
      const tr = currentTrack();
      if (!tr) return;
      setUiForTrack(tr);
      renderPlaylist();
      loadTrackSource(tr);
      let settled = false;
      let resumeApplied = false;
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("canplay", tryPlay);
        clearTimeout(fallbackTimer);
      };
      const applyResume = () => {
        if (resumeApplied) return;
        resumeApplied = true;
        const st2 = loadState();
        const t0 =
          validSavedIdx(st2) && st2.idx === idx && typeof st2.t === "number" ? st2.t : 0;
        if (t0 > 0 && Number.isFinite(audio.duration) && t0 < audio.duration - 0.25) {
          audio.currentTime = t0;
        }
      };
      const onPlayed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        syncPlaybackState();
        syncMediaSessionPosition();
      };
      const tryPlay = () => {
        if (settled) return;
        const p = audio.play();
        if (p !== undefined) {
          p.then(onPlayed).catch(() => {});
        } else {
          onPlayed();
        }
      };
      const onMeta = () => {
        applyResume();
        tryPlay();
      };
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("canplay", tryPlay);
      const fallbackTimer = setTimeout(() => tryPlay(), 2200);
      audio.load();
      tryPlay();
      return;
    }
    togglePlay();
  });

  btnNext.addEventListener("click", () => nextTrack());
  btnPrev.addEventListener("click", () => prevTrack());

  btnLyricsNow.addEventListener("click", () => {
    const t = currentTrack();
    if (t) openLyrics(t);
  });

  modalClose.addEventListener("click", () => closeLyrics());
  modalRoot.addEventListener("click", (e) => {
    if (e.target === modalRoot) closeLyrics();
  });

  audio.addEventListener("timeupdate", () => {
    onTimeUpdateMeter();
    const d = audio.duration;
    const c = audio.currentTime;
    if (Number.isFinite(d) && d > 0) {
      seek.max = 1000;
      seek.value = Math.min(1000, Math.round((c / d) * 1000));
      tCur.textContent = fmtTime(c);
    }
    paintSeekBar();
    const now = Date.now();
    if (now - lastPositionSyncMs > 850) {
      lastPositionSyncMs = now;
      syncMediaSessionPosition();
    }
    saveStateSoon();
  });

  audio.addEventListener("play", () => {
    const tr = currentTrack();
    if (tr) npTitle.textContent = tr.title;
    lastTickTime = audio.currentTime;
    updatePlayButton();
    syncPlaybackState();
  });

  audio.addEventListener("pause", () => {
    lastTickTime = null;
    updatePlayButton();
    syncPlaybackState();
    saveStateSoon();
  });

  audio.addEventListener("seeked", () => {
    lastTickTime = audio.currentTime;
    lastPositionSyncMs = 0;
    syncMediaSessionPosition();
    if (audio.currentTime < 1.5) {
      listenedSec = 0;
      countedThisRound = false;
    }
  });

  audio.addEventListener("ended", () => {
    resetListenMeter();
    nextTrack();
  });

  audio.addEventListener("loadedmetadata", () => {
    paintSeekBar();
    lastPositionSyncMs = 0;
    syncMediaSessionPosition();
  });

  audio.addEventListener("error", () => {
    const err = audio.error;
    const tr = currentTrack();
    if (!err || !tr) return;
    /* Під час load()/зміни src часто прилітає MEDIA_ERR_ABORTED — це не справжня помилка файлу. */
    if (err.code === MediaError.MEDIA_ERR_ABORTED) return;
    npTitle.textContent = `${tr.title} (помилка завантаження)`;
  });

  seek.addEventListener("input", () => {
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const v = Number(seek.value) / 1000;
    audio.currentTime = v * d;
    paintSeekBar();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveStateSoon();
  });
}

async function boot() {
  wire();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register(new URL("./sw.js", import.meta.url));
    } catch {
      /* ignore */
    }
  }

  const res = await fetch(new URL("./tracks.json", import.meta.url), { cache: "no-store" });
  data = await res.json();
  if (!data.tracks || !data.tracks.length) {
    document.title = "AriSongs";
    npTitle.textContent = "Немає треків";
    return;
  }

  const st = loadState();
  if (validSavedIdx(st)) {
    idx = st.idx;
  }

  setUiForTrack(data.tracks[idx]);
  renderPlaylist();
  updatePlayButton();

  seek.value = 0;
  tCur.textContent = "0:00";
  paintSeekBar();
}

boot().catch(() => {
  document.title = "AriSongs";
  npTitle.textContent = "Не вдалося завантажити tracks.json";
});
