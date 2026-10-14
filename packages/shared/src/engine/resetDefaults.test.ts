import { describe, expect, it } from "vitest";
import { DEFAULT_JUKEBOX_CONFIG, JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import type { Edge, JukeboxGraphState, QuantumBase, TrackAnalysis } from "./types";
import {
  hasNonDefaultExtras,
  hasNonDefaultTuning,
  hasNonDefaultTuningConfig,
} from "./resetDefaults";

function engineWith({
  config = {},
  deleted = false,
  userAnchorEdgeId = null,
}: {
  config?: Partial<typeof DEFAULT_JUKEBOX_CONFIG>;
  deleted?: boolean;
  userAnchorEdgeId?: number | null;
} = {}) {
  return {
    getConfig: () => ({ ...DEFAULT_JUKEBOX_CONFIG, ...config }),
    getGraphState: () => ({ allEdges: [{ id: 1, deleted }] }),
    getVisualizationData: () => ({ userAnchorEdgeId }),
  } as unknown as Parameters<typeof hasNonDefaultTuning>[0];
}

describe("hasNonDefaultTuningConfig", () => {
  it("is false for the defaults and for default probabilities round-tripped through percents", () => {
    expect(hasNonDefaultTuningConfig({ ...DEFAULT_JUKEBOX_CONFIG })).toBe(false);
    expect(
      hasNonDefaultTuningConfig({
        ...DEFAULT_JUKEBOX_CONFIG,
        minRandomBranchChance: 18 / 100,
        maxRandomBranchChance: 50 / 100,
        randomBranchChanceDelta: 10 / (100 / 0.2),
      }),
    ).toBe(false);
  });

  it("flags each resettable field", () => {
    for (const change of [
      { currentThreshold: 40 },
      { justBackwards: true },
      { justLongBranches: true },
      { removeSequentialBranches: true },
      { minRandomBranchChance: 0.2 },
      { maxRandomBranchChance: 0.6 },
      { randomBranchChanceDelta: 0.04 },
    ]) {
      expect(hasNonDefaultTuningConfig({ ...DEFAULT_JUKEBOX_CONFIG, ...change })).toBe(true);
    }
  });

  it("compares against the given defaults", () => {
    const defaults = { ...DEFAULT_JUKEBOX_CONFIG, justBackwards: true };
    expect(hasNonDefaultTuningConfig({ ...defaults }, defaults)).toBe(false);
  });
});

describe("hasNonDefaultTuning", () => {
  it("is false when config, branches, and anchor are all default", () => {
    expect(hasNonDefaultTuning(engineWith())).toBe(false);
  });

  it("flags config changes, deleted branches, and a non-default user anchor", () => {
    expect(hasNonDefaultTuning(engineWith({ config: { justBackwards: true } }))).toBe(true);
    expect(hasNonDefaultTuning(engineWith({ deleted: true }))).toBe(true);
    expect(hasNonDefaultTuning(engineWith({ userAnchorEdgeId: 7 }))).toBe(true);
  });
});

function makeBeat(which: number): QuantumBase {
  return {
    start: which,
    duration: 1,
    confidence: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  };
}

// Beat 1 is the last branch point, so its edge is the track's default anchor.
function makeEngineWithAnchors() {
  const engine = new JukeboxEngine({} as JukeboxPlayer);
  const beats = [makeBeat(0), makeBeat(1), makeBeat(2)];
  beats.forEach((beat, index) => {
    beat.prev = beats[index - 1] ?? null;
    beat.next = beats[index + 1] ?? null;
  });
  const defaultAnchor: Edge = { id: 0, src: beats[1], dest: beats[0], distance: 10, deleted: false };
  const otherEdge: Edge = { id: 1, src: beats[2], dest: beats[0], distance: 9, deleted: false };
  beats[1].neighbors = [defaultAnchor];
  beats[1].allNeighbors = [defaultAnchor];
  beats[2].neighbors = [otherEdge];
  beats[2].allNeighbors = [otherEdge];
  const graph: JukeboxGraphState = {
    computedThreshold: 0,
    currentThreshold: 0,
    lastBranchPoint: 1,
    totalBeats: beats.length,
    longestReach: 0,
    allEdges: [defaultAnchor, otherEdge],
  };
  Object.assign(engine as unknown as {
    analysis: TrackAnalysis;
    graph: JukeboxGraphState;
    beats: QuantumBase[];
  }, {
    analysis: { sections: [], bars: [], beats, tatums: [], segments: [], track: { duration: 3 } },
    graph,
    beats,
  });
  return { engine, defaultAnchor, otherEdge };
}

describe("hasNonDefaultTuning with a real engine", () => {
  it("ignores a user anchor on the default anchor edge", () => {
    const { engine, defaultAnchor, otherEdge } = makeEngineWithAnchors();
    expect(hasNonDefaultTuning(engine)).toBe(false);
    engine.setUserAnchorEdge(defaultAnchor);
    expect(hasNonDefaultTuning(engine)).toBe(false);
    engine.setUserAnchorEdge(otherEdge);
    expect(hasNonDefaultTuning(engine)).toBe(true);
  });
});

describe("hasNonDefaultExtras", () => {
  it("counts audio mode and bring it home only", () => {
    expect(hasNonDefaultExtras({ audioMode: "off", bringItHomeMode: false })).toBe(false);
    expect(hasNonDefaultExtras({ audioMode: "daycore", bringItHomeMode: false })).toBe(true);
    expect(hasNonDefaultExtras({ audioMode: "off", bringItHomeMode: true })).toBe(true);
  });
});
