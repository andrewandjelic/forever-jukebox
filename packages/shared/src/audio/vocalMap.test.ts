import { describe, expect, it } from "vitest";
import { parseVocalMap } from "../engine/vocals";
import { PRINT_BANDS, buildVocalMap, mixLoudnessDb } from "./vocalMap";

const SAMPLE_RATE = 44_100;

// A "voice": a harmonic tone that is on during the given [from, to) spans.
// `retrigger` times restart the tone at a new pitch without a gap in between,
// the way a new syllable does.
function voice(
  seconds: number,
  spans: Array<[number, number]>,
  retrigger: number[] = [],
): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i += 1) {
    const time = i / SAMPLE_RATE;
    if (!spans.some(([from, to]) => time >= from && time < to)) {
      continue;
    }
    // A little vibrato and tremolo, as a held voice has: a perfectly steady
    // tone has no spectral movement at all to compare a new syllable with.
    const pitch = 220 * (1 + 0.5 * retrigger.filter((at) => time >= at).length);
    const phase = 2 * Math.PI * pitch * time + 3 * Math.sin(2 * Math.PI * 5.5 * time);
    let value = 0;
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      value += Math.sin(harmonic * phase) / harmonic;
    }
    samples[i] = value * 0.2 * (1 + 0.15 * Math.sin(2 * Math.PI * 4 * time));
  }
  return samples;
}

function beatsEvery(seconds: number, total: number) {
  return Array.from({ length: Math.floor(total / seconds) }, (_item, index) => ({
    start: index * seconds,
    duration: seconds,
  }));
}

describe("buildVocalMap", () => {
  // Singing from 1.0 s to 3.0 s, with a new syllable at 2.0 s, in 6 s of
  // audio cut into half-second beats.
  const beats = beatsEvery(0.5, 6);
  const map = buildVocalMap(voice(6, [[1, 3]], [2]), SAMPLE_RATE, beats);

  it("marks where singing starts, carries on, changes and stops", () => {
    // Beats start at 0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, ...
    expect(map.state[1]).toBe("0"); // silence either side of 0.5 s
    expect(map.state[2]).toBe("1"); // singing begins at 1.0 s
    expect(map.state[3]).toBe("4"); // a held note through 1.5 s
    expect(map.state[4]).toBe("3"); // a new syllable at 2.0 s
    expect(map.state[5]).toBe("4"); // held through 2.5 s
    expect(map.state[6]).toBe("2"); // singing stops at 3.0 s
    expect(map.state[8]).toBe("0");
  });

  it("marks the beats that have singing in them", () => {
    expect(map.sung).toBe("001111000000");
  });

  it("produces a map the engine accepts", () => {
    const parsed = parseVocalMap(map, beats.length);
    expect(parsed).not.toBeNull();
    expect(parsed?.width).toBe(PRINT_BANDS * 2);
  });

  it("prints the same voice alike and silence differently", () => {
    const parsed = parseVocalMap(map, beats.length)!;
    const row = (beat: number) =>
      parsed.print.subarray(beat * parsed.width, (beat + 1) * parsed.width);
    const distance = (a: Uint8Array, b: Uint8Array) =>
      Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
    // Two points inside the same held note, against a point in silence.
    expect(distance(row(3), row(3))).toBe(0);
    expect(distance(row(5), row(8))).toBeGreaterThan(20);
  });

  it("reads a song with no singing as all gaps", () => {
    // What separation leaves of an instrumental: a faint residue all the way
    // through, far under the mix it came from.
    const mix = voice(3, [[0, 3]]);
    const residue = mix.map((value) => value * 0.003);
    const map = buildVocalMap(
      residue,
      SAMPLE_RATE,
      beatsEvery(0.5, 3),
      mixLoudnessDb(mix, SAMPLE_RATE),
    );
    expect(map.state).toBe("000000");
    expect(map.sung).toBe("000000");
  });

  it("still hears a voice that sits under its backing", () => {
    // A voice a quarter as loud as the mix (12 dB down) is ordinary.
    const quiet = voice(6, [[1, 3]], [2]).map((value) => value * 0.25);
    const backing = voice(6, [[0, 6]]);
    const held = buildVocalMap(quiet, SAMPLE_RATE, beats, mixLoudnessDb(backing, SAMPLE_RATE));
    expect(held.sung).toBe(map.sung);
    expect(held.state).toBe(map.state);
  });

  it("copes with audio shorter than one frame", () => {
    const tiny = buildVocalMap(new Float32Array(100), SAMPLE_RATE, beatsEvery(0.5, 1));
    expect(tiny.state).toBe("00");
    expect(parseVocalMap(tiny, 2)).not.toBeNull();
  });
});
