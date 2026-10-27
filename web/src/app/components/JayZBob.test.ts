import { describe, expect, it } from "vitest";
import { bobFrame } from "./JayZBob";

describe("bobFrame", () => {
  it("has the head down on the beat and up halfway between", () => {
    // ~122 BPM: one nod per beat, down (frame 9) -> up (5).
    expect(bobFrame(0, 0, 0.49)).toBe(9);
    expect(bobFrame(0, 0.25, 0.49)).toBe(8);
    expect(bobFrame(0, 0.49, 0.49)).toBe(5);
  });

  it("alternates the two nods, swapping at the top", () => {
    expect(bobFrame(0, 0.51, 0.49)).toBe(14);
    expect(bobFrame(1, 0, 0.49)).toBe(17);
    expect(bobFrame(1, 0.51, 0.49)).toBe(5);
    expect(bobFrame(2, 0, 0.49)).toBe(9);
  });

  it("nods every other beat on fast songs and twice per beat on slow ones", () => {
    // 240 BPM: a full nod spans two beats.
    expect(bobFrame(0, 0, 0.25)).toBe(9);
    expect(bobFrame(1, 0, 0.25)).toBe(14);
    // 60 BPM: two nods per beat.
    expect(bobFrame(0, 0.25, 1.0)).toBe(14);
    expect(bobFrame(0, 0.5, 1.0)).toBe(17);
  });
});
