import { describe, expect, it } from "vitest";
import { bobFrame } from "./JayZBob";

describe("bobFrame", () => {
  it("starts each bob's head dip exactly on the beat", () => {
    // 122 BPM ~ the GIF's own pace: one bob per beat, dips on frames 1/8/15.
    expect(bobFrame(0, 0, 0.49)).toBe(1);
    expect(bobFrame(1, 0, 0.49)).toBe(8);
    expect(bobFrame(2, 0, 0.49)).toBe(15);
    expect(bobFrame(3, 0, 0.49)).toBe(1);
    expect(bobFrame(0, 0.99, 0.49)).toBe(7);
  });

  it("bobs every other beat on fast songs and twice per beat on slow ones", () => {
    // 240 BPM: a full bob spans two beats.
    expect(bobFrame(0, 0, 0.25)).toBe(1);
    expect(bobFrame(1, 0, 0.25)).toBe(1 + 3);
    expect(bobFrame(2, 0, 0.25)).toBe(8);
    // 60 BPM: two bobs per beat.
    expect(bobFrame(0, 0.5, 1.0)).toBe(8);
  });
});
