import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_JUKEBOX_CONFIG,
  JUMP_LOOKAHEAD_BEATS,
  JukeboxEngine,
  type JukeboxPlayer,
} from "./JukeboxEngine";
import { buildJumpGraph } from "./graph";
import type { JukeboxGraphState, QuantumBase, TrackAnalysis } from "./types";

const BEATS = 64;

function makeAnalysis(): TrackAnalysis {
  const beats: QuantumBase[] = Array.from({ length: BEATS }, (_item, which) => ({
    start: which,
    duration: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  }));
  beats.forEach((beat, idx) => {
    beat.prev = idx > 0 ? beats[idx - 1] : null;
    beat.next = idx < beats.length - 1 ? beats[idx + 1] : null;
  });
  // A jump back sixteen beats from every fourth beat from beat 20 on: enough
  // of them for the threshold to settle at their distance.
  let id = 0;
  for (let src = 20; src < BEATS; src += 4) {
    beats[src].allNeighbors.push({
      id,
      src: beats[src],
      dest: beats[src - 16],
      distance: 10,
      deleted: false,
    });
    id += 1;
  }
  // Marks the neighbor lists as already worked out (the graph builder checks
  // the first beat); too distant to be used as a jump itself.
  beats[0].allNeighbors.push({
    id,
    src: beats[0],
    dest: beats[32],
    distance: 79,
    deleted: false,
  });
  return { sections: [], bars: [], beats, tatums: [], segments: [], track: {} };
}

function makeEngine(seed: number, overrides: Partial<typeof DEFAULT_JUKEBOX_CONFIG> = {}) {
  const player: JukeboxPlayer = {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(() => true),
    cancelScheduledJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => true,
  };
  const config = { ...DEFAULT_JUKEBOX_CONFIG, ...overrides };
  const analysis = makeAnalysis();
  const graph = buildJumpGraph(analysis, config);
  const engine = new JukeboxEngine(player, { randomMode: "seeded", seed, config });
  const internals = engine as unknown as {
    analysis: TrackAnalysis;
    graph: JukeboxGraphState;
    beats: QuantumBase[];
    currentBeatIndex: number;
    nextAudioTime: number;
    lastJumped: boolean;
    advanceBeat: (audioTime: number) => void;
  };
  internals.analysis = analysis;
  internals.graph = graph;
  internals.beats = analysis.beats;
  internals.currentBeatIndex = -1;
  internals.nextAudioTime = 0;
  return { engine, internals };
}

describe("JukeboxEngine jump look-ahead", () => {
  it("names a jump beats before it happens, and then takes exactly that jump", () => {
    const { engine, internals } = makeEngine(7);
    let announced: { fromIndex: number; toIndex: number; atStep: number } | null = null;
    let jumps = 0;
    let longestNotice = 0;

    for (let step = 0; step < 600; step += 1) {
      const before = internals.currentBeatIndex;
      internals.advanceBeat(step);
      const now = internals.currentBeatIndex;
      const sequential = now === before + 1 || before < 0 || (before === BEATS - 1 && now === 0);

      if (!sequential) {
        // Every jump was the one named beforehand.
        expect(announced, `step ${step}: jump ${before} -> ${now} was not announced`).not.toBeNull();
        expect([announced!.fromIndex, announced!.toIndex]).toEqual([before + 1, now]);
        longestNotice = Math.max(longestNotice, step - announced!.atStep);
        jumps += 1;
        announced = null;
      } else if (announced) {
        // A named jump is never passed by.
        expect(now, `step ${step}: passed the announced jump`).toBeLessThan(announced.fromIndex);
      }

      const upcoming = engine.getUpcomingJump();
      if (upcoming && !announced) {
        announced = { ...upcoming, atStep: step };
      } else if (upcoming && announced) {
        // Once named, a jump does not change its mind.
        expect([upcoming.fromIndex, upcoming.toIndex]).toEqual([
          announced.fromIndex,
          announced.toIndex,
        ]);
      }
      if (upcoming) {
        expect(upcoming.fromIndex - now).toBeGreaterThanOrEqual(1);
        expect(upcoming.fromIndex - now).toBeLessThanOrEqual(JUMP_LOOKAHEAD_BEATS + 1);
      }
    }

    expect(jumps).toBeGreaterThan(10);
    expect(longestNotice).toBeGreaterThanOrEqual(8);
  });

  it("reports the coming jump to its listener", () => {
    const { engine, internals } = makeEngine(7);
    const seen: Array<[number | null | undefined, number | null | undefined]> = [];
    engine.onUpdate((state) => seen.push([state.nextJumpFromIndex, state.nextJumpToIndex]));
    const emit = engine as unknown as { emitState: (jumped: boolean) => void };
    for (let step = 0; step < 40; step += 1) {
      internals.advanceBeat(step);
      emit.emitState(false);
    }
    expect(seen.some(([from, to]) => typeof from === "number" && typeof to === "number")).toBe(true);
    expect(seen[0]).toEqual([null, null]);
  });

  it("forgets its plans when the listener takes over", () => {
    const { engine, internals } = makeEngine(7);
    let step = 0;
    // Play until a jump is in sight but not yet due.
    for (; step < 200; step += 1) {
      internals.advanceBeat(step);
      const upcoming = engine.getUpcomingJump();
      if (upcoming && upcoming.fromIndex - internals.currentBeatIndex > 2) {
        break;
      }
    }
    expect(engine.getUpcomingJump()).not.toBeNull();

    engine.setForceBranch(true);
    expect(engine.getUpcomingJump()).toBeNull();

    engine.setForceBranch(false);
    engine.updateConfig({ maxRandomBranchChance: 0.4 });
    expect(engine.getUpcomingJump()).toBeNull();
  });
});

describe("JukeboxEngine minimum wait between jumps", () => {
  // Plays `steps` beats and returns each jump: the step it happened on and
  // the beat it left before.
  function jumpsOver(steps: number, minBeatsBetweenJumps: number) {
    const { engine, internals } = makeEngine(11, { minBeatsBetweenJumps });
    const jumps: Array<{ step: number; from: number }> = [];
    for (let step = 0; step < steps; step += 1) {
      const before = internals.currentBeatIndex;
      const upcoming = engine.getUpcomingJump();
      internals.advanceBeat(step);
      const now = internals.currentBeatIndex;
      const sequential =
        now === before + 1 || before < 0 || (before === BEATS - 1 && now === 0);
      if (!sequential) {
        // The look-ahead still names every jump before it happens.
        expect(upcoming, `step ${step}`).toEqual({ fromIndex: before + 1, toIndex: now });
        jumps.push({ step, from: before + 1 });
      }
    }
    return { jumps, loopBack: internals.graph.lastBranchPoint };
  }

  it("lets every landing play for at least that many beats", () => {
    const { jumps, loopBack } = jumpsOver(2000, 8);
    expect(jumps.length).toBeGreaterThan(20);
    for (let i = 1; i < jumps.length; i += 1) {
      if (jumps[i].from === loopBack) {
        // The loop-back jump is never held back.
        continue;
      }
      expect(jumps[i].step - jumps[i - 1].step, `jump ${i}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("spaces the jumps out compared with no wait", () => {
    const closeTogether = (jumps: Array<{ step: number }>) =>
      jumps.filter((jump, i) => i > 0 && jump.step - jumps[i - 1].step < 8).length;
    const free = jumpsOver(2000, 0);
    const held = jumpsOver(2000, 8);
    expect(closeTogether(free.jumps)).toBeGreaterThan(10);
    expect(closeTogether(held.jumps)).toBeLessThanOrEqual(
      held.jumps.filter((jump) => jump.from === held.loopBack).length,
    );
    expect(held.jumps.length).toBeLessThan(free.jumps.length);
  });
});
