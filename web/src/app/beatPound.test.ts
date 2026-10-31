import { describe, expect, it } from "vitest";
import type { QuantumBase, Segment } from "@forever-jukebox/shared/types";
import { beatLoudness, beatStrength, poundEnvelope } from "./beatPound";

describe("beat pound", () => {
  it("pounds harder on louder beats", () => {
    expect(beatStrength(-4)).toBe(1);
    expect(beatStrength(0)).toBe(1);
    expect(beatStrength(-17)).toBeCloseTo(0.5);
    expect(beatStrength(-30)).toBe(0.2);
    expect(beatStrength(-60)).toBe(0.2);
    expect(beatStrength(null)).toBe(0.6);
  });

  it("kicks at the beat and dies away within a fraction of it", () => {
    expect(poundEnvelope(0, 0.8)).toBe(0.8);
    expect(poundEnvelope(0.12, 1)).toBeCloseTo(Math.exp(-1));
    expect(poundEnvelope(0.5, 1)).toBeLessThan(0.02);
    expect(poundEnvelope(-0.01, 1)).toBe(0);
    // A slower decay (Moth's bloom) lingers longer.
    expect(poundEnvelope(0.45, 1, 0.45)).toBeCloseTo(Math.exp(-1));
    expect(poundEnvelope(0.3, 1, 0.45)).toBeGreaterThan(poundEnvelope(0.3, 1));
  });

  it("takes a beat's loudness from its loudest segment", () => {
    const beat = (loudness: number[]) =>
      ({
        overlappingSegments: loudness.map(
          (loudness_max) => ({ loudness_max }) as Segment,
        ),
      }) as QuantumBase;
    expect(beatLoudness(beat([-20, -6, -12]))).toBe(-6);
    expect(beatLoudness(beat([]))).toBeNull();
  });
});
