import { describe, expect, it } from "vitest";
import type { QuantumBase } from "../engine/types";
import {
  computeBeatColors,
  rippleAt,
  shapeWaveform,
  spikeWaveform,
  traceWaveCurve,
  traceWaveRing,
} from "./JukeboxViz";

function recorder() {
  const points: Array<[number, number]> = [];
  return {
    points,
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
  };
}

describe("waveform tracing", () => {
  it("pins arc ends to their beats and displaces the middle", () => {
    const wave = new Float32Array(2048).fill(1);
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const control = { x: 50, y: 0 };
    const flat = recorder();
    const live = recorder();

    traceWaveCurve(flat, from, control, to, null, 0, 20);
    traceWaveCurve(live, from, control, to, wave, 0, 20);

    expect(live.points[0][0]).toBeCloseTo(0);
    expect(live.points[0][1]).toBeCloseTo(0);
    expect(live.points.at(-1)![0]).toBeCloseTo(100);
    expect(live.points.at(-1)![1]).toBeCloseTo(0);
    expect(flat.points.every(([, y]) => Math.abs(y) < 1e-9)).toBe(true);
    const peak = Math.max(...live.points.map(([, y]) => Math.abs(y)));
    expect(peak).toBeGreaterThan(19);
    expect(peak).toBeLessThanOrEqual(20);
  });

  it("closes the ring seamlessly and follows the waveform radius", () => {
    const wave = new Float32Array(2048).map((_, i) => Math.sin(i / 40));
    const ring = recorder();

    traceWaveRing(ring, { x: 0, y: 0 }, 100, wave, 10);

    const [first, last] = [ring.points[0], ring.points.at(-1)!];
    expect(last[0]).toBeCloseTo(first[0]);
    expect(last[1]).toBeCloseTo(first[1]);
    const radii = ring.points.map(([x, y]) => Math.hypot(x, y));
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...radii)).toBeLessThanOrEqual(110);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(5);
  });

  it("auto-gains quiet audio to full swing but leaves near-silence small", () => {
    const quiet = new Float32Array(2048).map((_, i) => 0.2 * Math.sin(i / 50));
    const hiss = new Float32Array(2048).map((_, i) => 0.01 * Math.sin(i / 50));

    const shapedQuiet = shapeWaveform(quiet);
    const shapedHiss = shapeWaveform(hiss);

    expect(shapedQuiet).toHaveLength(256);
    expect(Math.max(...shapedQuiet.map(Math.abs))).toBeCloseTo(1, 5);
    expect(Math.max(...shapedHiss.map(Math.abs))).toBeLessThan(0.1);
  });

  it("colors beats by timbre so similar-sounding beats match", () => {
    const beat = (timbre: number[] | null) =>
      ({
        overlappingSegments: timbre ? [{ timbre }] : [],
      }) as unknown as QuantumBase;
    const colors = computeBeatColors([
      beat([0, 10, 5]),
      beat([0, 10.1, 5]),
      beat([0, 90, 40]),
      beat(null),
    ]);

    expect(colors[0]).toMatch(/^hsl\(/);
    expect(colors[1]).toBe(colors[0]);
    expect(colors[2]).not.toBe(colors[0]);
    expect(colors[3]).toBe("");
  });

  it("keeps beat colors inside a style's hue range", () => {
    const beats = Array.from({ length: 20 }, (_, i) => ({
      overlappingSegments: [{ timbre: [0, i * 5, i] }],
    })) as unknown as QuantumBase[];

    const hues = computeBeatColors(beats, {
      hueStart: 8,
      hueRange: 50,
      saturation: "75%",
    }).map((color) => Number(/hsl\((\d+)/.exec(color)![1]));

    expect(Math.min(...hues)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...hues)).toBeLessThanOrEqual(58);
    expect(new Set(hues).size).toBeGreaterThan(2);
  });
});

describe("rippleAt", () => {
  it("spreads outward while its waves flatten faster than it fades", () => {
    const young = rippleAt(200);
    const old = rippleAt(1400);
    expect(rippleAt(0)).toEqual({ spread: 0, amplitude: 1, alpha: 1 });
    expect(old.spread).toBeGreaterThan(young.spread);
    expect(old.amplitude).toBeLessThan(young.amplitude);
    expect(old.amplitude).toBeLessThan(old.alpha);
    expect(rippleAt(5000)).toEqual({ spread: 1, amplitude: 0, alpha: 0 });
  });
});

describe("spikeWaveform", () => {
  it("points every sample outward and sharpens peaks over the baseline", () => {
    const wave = new Float32Array([0.5, -0.5, 0.5, -1, 0.2, 0, 0.25, -0.25, 0.1]);
    const spiked = spikeWaveform(wave, 3);
    // Block peaks 0.5 / 1 / 0.25: loudest is a full spike, quietest is flat.
    expect(spiked[1]).toBe(1);
    expect(spiked[2]).toBe(0);
    expect(spiked.every((v) => v >= 0)).toBe(true);
    // A third of the way up becomes well under a third: a spike, not a hump.
    expect(spiked[0]).toBeLessThan(0.2);
  });

  it("still spikes when every block is loud", () => {
    const loud = new Float32Array([0.9, -0.95, 1, 0.92, -0.9, 0.97]);
    const spiked = spikeWaveform(loud, 1);
    expect(Math.max(...spiked) - Math.min(...spiked)).toBeGreaterThan(0.3);
  });
});
