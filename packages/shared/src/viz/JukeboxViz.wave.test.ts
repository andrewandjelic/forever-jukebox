import { describe, expect, it } from "vitest";
import type { QuantumBase } from "../engine/types";
import {
  computeBeatColors,
  shapeWaveform,
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
