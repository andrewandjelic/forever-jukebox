import { describe, expect, it } from "vitest";
import { happyPathAnalysis } from "./__fixtures__/analysisFixtures";
import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import { DEFAULT_JUKEBOX_CONFIG } from "./JukeboxEngine";
import type { TrackAnalysis } from "./types";
import {
  VOCAL_GAP,
  VOCAL_SUSTAINED,
  isVocalJumpAllowed,
  parseVocalMap,
  voiceDistance,
} from "./vocals";

const QUIET = [0, 0, 0, 0];
const BEATS = 12;

// A `vocals` object as the analysis carries it: a state digit and a 4-byte
// print per beat.
function vocalsObject(states: number[], prints: number[][]) {
  return {
    version: 1,
    state: states.join(""),
    sung: states.map((state) => (state === VOCAL_GAP ? 0 : 1)).join(""),
    print: btoa(String.fromCharCode(...prints.flat())),
  };
}

function analysisWith(held: Record<number, number[]>): TrackAnalysis {
  const states = Array.from({ length: BEATS }, (_item, idx) =>
    idx in held ? VOCAL_SUSTAINED : VOCAL_GAP,
  );
  const prints = Array.from({ length: BEATS }, (_item, idx) => held[idx] ?? QUIET);
  return normalizeAnalysis({
    ...happyPathAnalysis(),
    vocals: vocalsObject(states, prints),
  });
}

function edgePairs(analysis: TrackAnalysis, respectVocals: boolean): string[] {
  buildJumpGraph(analysis, { ...DEFAULT_JUKEBOX_CONFIG, respectVocals });
  return analysis.beats
    .flatMap((beat) => beat.neighbors.map((edge) => `${beat.which}>${edge.dest.which}`))
    .sort();
}

describe("parseVocalMap", () => {
  const valid = vocalsObject(
    Array.from({ length: BEATS }, () => VOCAL_GAP),
    Array.from({ length: BEATS }, () => QUIET),
  );

  it("reads a well-formed map", () => {
    const map = parseVocalMap(valid, BEATS);
    expect(map?.state).toHaveLength(BEATS);
    expect(map?.sung).toHaveLength(BEATS);
    expect(map?.width).toBe(4);
  });

  it("reads anything else as no map", () => {
    expect(parseVocalMap(undefined, BEATS)).toBeNull();
    expect(parseVocalMap({ ...valid, version: 2 }, BEATS)).toBeNull();
    expect(parseVocalMap({ ...valid, state: valid.state.slice(1) }, BEATS)).toBeNull();
    expect(parseVocalMap({ ...valid, state: valid.state.replace("0", "9") }, BEATS)).toBeNull();
    expect(parseVocalMap({ ...valid, sung: "" }, BEATS)).toBeNull();
    expect(parseVocalMap({ ...valid, print: "not base64!" }, BEATS)).toBeNull();
    // 13 bytes do not divide into 12 beats.
    expect(parseVocalMap({ ...valid, print: btoa("x".repeat(13)) }, BEATS)).toBeNull();
    // The map belongs to a different beat grid.
    expect(parseVocalMap(valid, BEATS + 1)).toBeNull();
  });

  it("leaves a track without a map alone", () => {
    expect(normalizeAnalysis(happyPathAnalysis()).vocals).toBeNull();
  });
});

describe("isVocalJumpAllowed", () => {
  const map = analysisWith({ 5: [200, 200, 200, 200], 9: [100, 100, 100, 100] }).vocals!;

  it("allows a jump between two points with no singing running through", () => {
    expect(isVocalJumpAllowed(map, 1, 2)).toBe(true);
  });

  it("refuses to cut into or out of a held note", () => {
    expect(isVocalJumpAllowed(map, 5, 1)).toBe(false);
    expect(isVocalJumpAllowed(map, 1, 5)).toBe(false);
    // Two different held notes: 100 half-dB steps apart.
    expect(voiceDistance(map, 5, 9)).toBe(50);
    expect(isVocalJumpAllowed(map, 5, 9)).toBe(false);
  });

  it("allows a held note to continue as the same note elsewhere", () => {
    const same = analysisWith({ 5: [200, 200, 200, 200], 9: [200, 200, 200, 200] }).vocals!;
    expect(isVocalJumpAllowed(same, 5, 9)).toBe(true);
    expect(isVocalJumpAllowed(same, 5, 1)).toBe(false);
  });
});

describe("the jump graph under the vocal rule", () => {
  const touches = (pairs: string[], beat: number) =>
    pairs.filter((pair) => pair.split(">").map(Number).includes(beat));

  it("drops the jumps that would split a held note", () => {
    const analysis = analysisWith({ 5: [200, 200, 200, 200], 9: [100, 100, 100, 100] });
    expect(touches(edgePairs(analysis, false), 5).length).toBeGreaterThan(0);
    const kept = edgePairs(analysis, true);
    expect(touches(kept, 5)).toEqual([]);
    expect(touches(kept, 9)).toEqual([]);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("keeps a jump between two beats holding the same note", () => {
    const analysis = analysisWith({ 5: [200, 200, 200, 200], 9: [200, 200, 200, 200] });
    expect(touches(edgePairs(analysis, true), 5).sort()).toEqual(["5>9", "9>5"]);
  });

  it("changes nothing when the rule is off or the track has no map", () => {
    const plain = edgePairs(normalizeAnalysis(happyPathAnalysis()), false);
    const mapped = analysisWith({ 5: [200, 200, 200, 200] });
    expect(edgePairs(mapped, false)).toEqual(plain);
    expect(edgePairs(normalizeAnalysis(happyPathAnalysis()), true)).toEqual(plain);
  });

  it("rebuilds its neighbor lists when the rule is switched", () => {
    const analysis = analysisWith({ 5: [200, 200, 200, 200] });
    const off = edgePairs(analysis, false);
    const on = edgePairs(analysis, true);
    expect(on).not.toEqual(off);
    expect(edgePairs(analysis, false)).toEqual(off);
  });
});
