import {
  VOCAL_MAP_CANCELLED,
  canBuildVocalMaps,
  startVocalMapJob,
  type VocalMapJob,
  type VocalMapProgress,
} from "@forever-jukebox/shared/audio/vocalMapBuilder";
import { saveVocalMap } from "./api";
import type { AppContext } from "./context";
import i18n from "./i18n";
import { getLoadGeneration, isStaleLoad } from "./playback/load-generation";
import { useAppStore } from "./store";
import { showToast } from "./ui";

// Gives the loaded song a vocal map when it has none, so "Keep sung lines
// whole" works on songs nobody has mapped yet. The work runs in the
// background while the song plays: about a minute on a decent graphics card,
// plus a one-time download of the separation model. The finished map is sent
// to the server so the next load already has it.

const storageKey = "fj-keep-sung-lines";

// "Keep sung lines whole" is a listener's preference, remembered across
// songs, rather than part of one song's tuning.
export function resolveStoredVocalPreference(): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function storeVocalPreference(enabled: boolean) {
  try {
    localStorage.setItem(storageKey, enabled ? "1" : "0");
  } catch {
    // The choice still holds for this visit.
  }
}

export function vocalMapsBuildable(): boolean {
  return canBuildVocalMaps();
}

let job: VocalMapJob | null = null;
// Called with the app context after a map lands on a song whose jumps are
// already keeping sung lines whole, to redraw what the new graph changed.
let onGraphChanged: ((context: AppContext) => void) | null = null;

export function setVocalMapGraphListener(listener: (context: AppContext) => void) {
  onGraphChanged = listener;
}

function phasePercent({ phase, progress }: VocalMapProgress): number {
  const share = Math.max(0, Math.min(1, progress));
  // The download and the map itself are short next to the separation.
  if (phase === "download") {
    return Math.round(share * 10);
  }
  if (phase === "separate") {
    return 10 + Math.round(share * 88);
  }
  return 99;
}

// Starts mapping the loaded song if it needs it and nothing is in the way.
// `announce` says so with a message: used when the listener has just asked
// for sung lines to be kept whole, not for the quiet run after each load.
export function ensureVocalMap(
  context: AppContext,
  options: { announce?: boolean } = {},
) {
  const state = useAppStore.getState();
  if (!state.audioLoaded || !state.analysisLoaded || job) {
    return;
  }
  if (context.engine.hasVocalMap()) {
    useAppStore.setState({ vocalMapStatus: "ready", vocalMapPercent: 100 });
    return;
  }
  // Instrumental and Swing renders use the same model or pause playback; wait
  // for them rather than compete.
  if (!canBuildVocalMaps() || state.audioModePreparing) {
    return;
  }
  const source = context.player.getSourceBuffer();
  const beats = state.vizData?.beats;
  if (!source || !beats || beats.length === 0) {
    return;
  }
  const generation = getLoadGeneration();
  const jobId = state.lastJobId;
  useAppStore.setState({ vocalMapStatus: "working", vocalMapPercent: 0 });
  if (options.announce) {
    showToast(i18n.t("vocals.working"));
  }
  const started = startVocalMapJob(
    source,
    beats.map((beat) => ({ start: beat.start, duration: beat.duration })),
    (progress) => {
      if (job === started) {
        useAppStore.setState({ vocalMapPercent: phasePercent(progress) });
      }
    },
  );
  job = started;
  started.promise
    .then((map) => {
      if (job !== started || isStaleLoad(generation)) {
        return;
      }
      if (!context.engine.setVocalMap(map)) {
        throw new Error("The vocal map does not fit this song's beats");
      }
      useAppStore.setState({ vocalMapStatus: "ready", vocalMapPercent: 100 });
      if (context.engine.getConfig().respectVocals) {
        onGraphChanged?.(context);
        showToast(i18n.t("vocals.ready"));
      }
      if (jobId) {
        saveVocalMap(jobId, map).catch((err: unknown) => {
          console.warn(`Vocal map save failed: ${String(err)}`);
        });
      }
    })
    .catch((err: unknown) => {
      const cancelled = err instanceof Error && err.message === VOCAL_MAP_CANCELLED;
      if (job !== started || cancelled) {
        return;
      }
      console.warn(`Vocal map failed: ${String(err)}`);
      useAppStore.setState({ vocalMapStatus: "failed", vocalMapPercent: 0 });
      if (options.announce) {
        showToast(i18n.t("vocals.failed"), { icon: "error", tone: "error" });
      }
    })
    .finally(() => {
      if (job === started) {
        job = null;
      }
    });
}

// Stops any mapping in flight: the song is being replaced.
export function cancelVocalMap() {
  const running = job;
  job = null;
  running?.cancel();
  useAppStore.setState({ vocalMapStatus: "idle", vocalMapPercent: 0 });
}
