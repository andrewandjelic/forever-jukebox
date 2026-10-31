import { describe, expect, it } from "vitest";
import type { QuantumBase } from "../engine/types";
import {
  arcBand,
  computeBeatColors,
  createHourglassPositioner,
  medianBeatMs,
  rippleAt,
  shapeWaveform,
  spikeWaveform,
  traceWaveCurve,
  traceWaveRing,
  tumblePoint,
  widthStep,
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

  it("spreads a skewed track evenly over the palette when asked", () => {
    // Most beats sit together with one far outlier: by value they share a
    // hue, by rank they spread across the range.
    const beats = [
      ...Array.from({ length: 12 }, (_, i) => ({
        overlappingSegments: [{ timbre: [0, 90 + i * 0.5, 0] }],
      })),
      { overlappingSegments: [{ timbre: [0, 0, 0] }] },
    ] as unknown as QuantumBase[];
    const palette = { hueStart: 0, hueRange: 240, saturation: "80%" };
    const hueCount = (spread: "range" | "even") =>
      new Set(
        computeBeatColors(beats, { ...palette, spread })
          .slice(0, 12)
          .map((color) => /hsl\((-?\d+)/.exec(color)![1]),
      ).size;

    expect(hueCount("range")).toBeLessThanOrEqual(2);
    expect(hueCount("even")).toBeGreaterThanOrEqual(8);
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

describe("traceWaveRing rotation", () => {
  it("turns the whole ring clockwise by `rotation` radians", () => {
    const wave = new Float32Array(181);
    wave[0] = 1; // a spike at the top
    const ring = recorder();
    traceWaveRing(ring, { x: 0, y: 0 }, 100, wave, 10, Math.PI / 2);
    // A quarter turn clockwise puts the spike on the right (+x).
    const [x, y] = ring.points[0];
    expect(x).toBeCloseTo(110);
    expect(y).toBeCloseTo(0);
  });
});

describe("medianBeatMs", () => {
  it("uses the typical beat length, ignoring odd ones", () => {
    const beats = [0.1, 0.5, 0.5, 0.5, 2].map((duration) => ({ duration }));
    expect(medianBeatMs(beats)).toBe(500);
    expect(medianBeatMs([])).toBe(500);
  });
});

describe("tumblePoint", () => {
  const center = { x: 0, y: 0 };
  it("leaves the layout alone at rest and after a full turn", () => {
    expect(tumblePoint({ x: 100, y: 50 }, center, 0, 1000)).toEqual({ x: 100, y: 50 });
    const full = tumblePoint({ x: 100, y: 50 }, center, Math.PI * 2, 1000);
    expect(full.x).toBeCloseTo(100);
    expect(full.y).toBeCloseTo(50);
    expect(tumblePoint(center, center, 1, 1000)).toEqual(center);
  });

  it("never turns a flat ring fully edge-on", () => {
    // Sample a ring at many tumble angles; it should always keep some width
    // and height (an edge-on ring would collapse to a line).
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const pts = Array.from({ length: 36 }, (_, k) => {
        const t = (k / 36) * Math.PI * 2;
        return tumblePoint({ x: Math.cos(t) * 100, y: Math.sin(t) * 100 }, center, a, 1e6);
      });
      const area = pts.reduce((sum, p, k) => {
        const q = pts[(k + 1) % pts.length];
        return sum + (p.x * q.y - q.x * p.y) / 2;
      }, 0);
      // A face-on ring has area ~31,000; edge-on would be 0.
      expect(Math.abs(area)).toBeGreaterThan(5000);
    }
  });
});

describe("tumblePoint drag", () => {
  const center = { x: 0, y: 0 };
  it("yaw swings the right side away and pitch tips the top toward you", () => {
    // Yaw a quarter turn: a point on the right lands on the center line.
    const yawed = tumblePoint({ x: 100, y: 0 }, center, 0, 1000, Math.PI / 2, 0);
    expect(yawed.x).toBeCloseTo(0);
    // Small yaw only: the shape narrows but keeps its height.
    const narrow = tumblePoint({ x: 100, y: 0 }, center, 0, 1e6, 0.5, 0);
    expect(narrow.x).toBeCloseTo(100 * Math.cos(0.5));
    // Pitch a quarter turn: a point at the top lands on the center line.
    const pitched = tumblePoint({ x: 0, y: -100 }, center, 0, 1000, 0, Math.PI / 2);
    expect(pitched.y).toBeCloseTo(0);
  });
});

describe("tumblePoint depth", () => {
  it("draws nearer points larger, even at rest", () => {
    const center = { x: 0, y: 0 };
    const near = tumblePoint({ x: 100, y: 0, z: 100 }, center, 0, 1000);
    const far = tumblePoint({ x: 100, y: 0, z: -100 }, center, 0, 1000);
    expect(near.x).toBeGreaterThan(100);
    expect(far.x).toBeLessThan(100);
  });
});

describe("hourglass layout", () => {
  it("strings beats on lines between two rims that pinch into a waist", () => {
    const beats = Array.from({ length: 2000 }, () => ({}));
    const pts = createHourglassPositioner()({ beats } as never, 800, 500);
    const radial = (p: { x: number; z?: number }) => Math.hypot(p.x - 400, p.z ?? 0);
    const rim = pts.filter((p) => Math.abs(p.y - 250) > 200).map(radial);
    const waist = pts.filter((p) => Math.abs(p.y - 250) < 5).map(radial);
    // Ends of the lines sit on the rims; the middles pull in.
    expect(Math.min(...rim)).toBeGreaterThan(Math.max(...waist) * 1.5);
    // Consecutive beats never leap: lines join end to end.
    for (let i = 1; i < pts.length; i += 1) {
      const step = Math.hypot(
        pts[i].x - pts[i - 1].x,
        pts[i].y - pts[i - 1].y,
        (pts[i].z ?? 0) - (pts[i - 1].z ?? 0),
      );
      expect(step).toBeLessThan(20);
    }
  });
});

describe("arcBand", () => {
  it("puts arcs near the playhead in brighter bands than far ones", () => {
    const p = { x: 0, y: 0 };
    const near = arcBand({ x: 10, y: 0 }, { x: 400, y: 0 }, p, 500);
    const mid = arcBand({ x: 200, y: 0 }, { x: 300, y: 0 }, p, 500);
    const far = arcBand({ x: 450, y: 0 }, { x: 500, y: 0 }, p, 500);
    expect(near).toBe(0);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
    expect(arcBand({ x: 450, y: 0 }, { x: 500, y: 0 }, null, 500)).toBe(0);
  });
});

describe("widthStep", () => {
  it("thins lines with distance in a few half-octave steps", () => {
    expect(widthStep(1)).toBe(1);
    expect(widthStep(0.5)).toBe(0.5);
    expect(widthStep(0.1)).toBeLessThan(widthStep(0.5));
    // Clamped so near lines don't balloon and far ones don't vanish.
    expect(widthStep(100)).toBeLessThanOrEqual(2);
    expect(widthStep(0)).toBeGreaterThan(0);
  });
});
