import type { JukeboxAudioMode } from "../audio/audioModes";
import { DEFAULT_JUKEBOX_CONFIG, type JukeboxEngine } from "./JukeboxEngine";
import type { JukeboxConfig } from "./types";

// minLongBranchPercent only matters once justLongBranches is on, which is itself non-default.
export function hasNonDefaultTuningConfig(
  config: JukeboxConfig,
  defaults: JukeboxConfig = DEFAULT_JUKEBOX_CONFIG,
): boolean {
  return (
    config.currentThreshold !== defaults.currentThreshold ||
    config.justBackwards !== defaults.justBackwards ||
    config.justLongBranches !== defaults.justLongBranches ||
    config.removeSequentialBranches !== defaults.removeSequentialBranches ||
    config.minRandomBranchChance !== defaults.minRandomBranchChance ||
    config.maxRandomBranchChance !== defaults.maxRandomBranchChance ||
    config.randomBranchChanceDelta !== defaults.randomBranchChanceDelta
  );
}

// True when a tuning reset would change something: config, deleted branches,
// or a user anchor other than the track's default anchor.
export function hasNonDefaultTuning(
  engine: Pick<JukeboxEngine, "getConfig" | "getGraphState" | "getVisualizationData">,
  defaults: JukeboxConfig = DEFAULT_JUKEBOX_CONFIG,
): boolean {
  return (
    hasNonDefaultTuningConfig(engine.getConfig(), defaults) ||
    (engine.getGraphState()?.allEdges.some((edge) => edge.deleted) ?? false) ||
    (engine.getVisualizationData()?.userAnchorEdgeId ?? null) !== null
  );
}

// Branch stats is a sticky preference, so it never counts as a change to reset.
export function hasNonDefaultExtras(extras: {
  audioMode: JukeboxAudioMode;
  bringItHomeMode: boolean;
}): boolean {
  return extras.audioMode !== "off" || extras.bringItHomeMode;
}
