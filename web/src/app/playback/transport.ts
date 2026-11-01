import type { AppContext } from "../context";
import { trackPlay } from "../analytics";
import { LISTEN_TIMER_INTERVAL_MS } from "../constants";
import { getCurrentTrackId, useAppStore } from "../store";
import { showToast } from "../ui";
import {
  pulseVizStats,
  updateListenTimeDisplay,
  updatePlayButton,
} from "./status-ui";
import { requestWakeLock } from "./wake-lock";
import i18n from "../i18n";

let listenTimerId: number | null = null;

// Swing and Instrumental pre-render their buffers; playback waits for that.
export function isPlaybackBlockedForAudioMode() {
  const { jukeboxAudioMode, audioModePreparing } = useAppStore.getState();
  if (!audioModePreparing) {
    return false;
  }
  return jukeboxAudioMode === "swing" || jukeboxAudioMode === "instrumental";
}

function showPreparingToast() {
  const { jukeboxAudioMode } = useAppStore.getState();
  showToast(
    i18n.t(
      jukeboxAudioMode === "instrumental"
        ? "playback.preparingInstrumental"
        : "playback.preparingSwingEllipsis",
    ),
    { icon: "hourglass_top" },
  );
  updatePlayButton();
}

export function startListenTimer() {
  if (listenTimerId !== null) {
    return;
  }
  listenTimerId = window.setInterval(() => {
    updateListenTimeDisplay();
  }, LISTEN_TIMER_INTERVAL_MS);
}

export function stopListenTimer() {
  if (listenTimerId === null) {
    return;
  }
  window.clearInterval(listenTimerId);
  listenTimerId = null;
}

export function stopPlayback(context: AppContext) {
  const { cowbellOverlay, engine, jukebox } = context;
  cowbellOverlay.cancelScheduledHits();
  engine.stopJukebox();
  engine.resetStats();
  useAppStore.setState({ playTimerMs: 0 });
  useAppStore.setState({ lastPlayStamp: null });
  useAppStore.setState({ lastBeatIndex: null, beatsPlayedText: "0" });
  jukebox?.reset();
  useAppStore.setState({ isRunning: false });
  useAppStore.setState({ isPaused: false });
  useAppStore.setState({ shiftBranching: false });
  engine.setForceBranch(false);
  if (useAppStore.getState().bringItHomeMode) {
    useAppStore.setState({ bringItHomeMode: false });
    engine.setBringItHomeMode(false);
  }
  stopListenTimer();
  updateListenTimeDisplay();
  updatePlayButton();
}

export function pausePlayback(context: AppContext) {
  const { cowbellOverlay, engine } = context;
  if (!useAppStore.getState().isRunning) {
    return;
  }
  cowbellOverlay.cancelScheduledHits();
  engine.pauseJukebox();
  engine.syncToPlaybackPosition();
  const { lastPlayStamp, playTimerMs } = useAppStore.getState();
  if (lastPlayStamp !== null) {
    useAppStore.setState({
      playTimerMs: playTimerMs + (performance.now() - lastPlayStamp),
      lastPlayStamp: null,
    });
  }
  useAppStore.setState({ isRunning: false });
  useAppStore.setState({ isPaused: true });
  useAppStore.setState({ shiftBranching: false });
  engine.setForceBranch(false);
  stopListenTimer();
  updateListenTimeDisplay();
  updatePlayButton();
}

export function startJukeboxPlayback(context: AppContext, resetSession: boolean) {
  const { cowbellOverlay, engine, jukebox, player } = context;
  if (!jukebox) {
    return;
  }
  if (isPlaybackBlockedForAudioMode()) {
    showPreparingToast();
    return;
  }
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    if (!resetSession) {
      stopPlayback(context);
    }
    return;
  }
  if (resetSession) {
    cowbellOverlay.cancelScheduledHits();
    engine.stopJukebox();
    engine.resetStats();
    useAppStore.setState({ playTimerMs: 0 });
    useAppStore.setState({ lastPlayStamp: null });
    updateListenTimeDisplay();
    useAppStore.setState({ beatsPlayedText: "0" });
    useAppStore.setState({ lastBeatIndex: null });
    jukebox.reset();
    pulseVizStats();
  } else {
    engine.syncToPlaybackPosition();
  }
  engine.play();
  engine.startJukebox(resetSession);
  trackPlay("jukebox", getCurrentTrackId(), useAppStore.getState().trackTitle);
  useAppStore.setState({ lastPlayStamp: performance.now() });
  useAppStore.setState({ isRunning: true });
  useAppStore.setState({ isPaused: false });
  startListenTimer();
  updatePlayButton();
  if (document.fullscreenElement) {
    requestWakeLock();
  }
}

export function togglePlayback(context: AppContext) {
  if (useAppStore.getState().isRunning) {
    pausePlayback(context);
    return;
  }
  try {
    if (useAppStore.getState().isPaused) {
      startJukeboxPlayback(context, false);
      return;
    }
    startJukeboxPlayback(context, true);
  } catch (err) {
    console.warn(`Play error: ${String(err)}`);
  }
}

export function startJukeboxFromBeat(context: AppContext, index: number) {
  const { cowbellOverlay, engine, player } = context;
  if (isPlaybackBlockedForAudioMode()) {
    showPreparingToast();
    return;
  }
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    return;
  }
  const beat = useAppStore.getState().vizData?.beats[index];
  if (!beat) {
    return;
  }

  cowbellOverlay.cancelScheduledHits();
  player.seek(beat.start);
  engine.seekToBeat(index);
  useAppStore.setState({ lastBeatIndex: index });
  if (!useAppStore.getState().isRunning) {
    engine.play();
    engine.startJukebox(false);
    useAppStore.setState({ lastPlayStamp: performance.now() });
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({ isPaused: false });
    startListenTimer();
    updatePlayButton();
    if (document.fullscreenElement) {
      requestWakeLock();
    }
    return;
  }
  if (!player.isPlaying()) {
    engine.play();
  }
}

// The React transport buttons derive icon/label/disabled from the store;
// only the play-tab pulse needs an explicit write here.
