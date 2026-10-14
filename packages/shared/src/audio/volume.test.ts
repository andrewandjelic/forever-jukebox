import { describe, expect, it } from "vitest";
import { parseStoredVolumePct } from "./volume";

describe("parseStoredVolumePct", () => {
  it("defaults to full volume when nothing is stored", () => {
    expect(parseStoredVolumePct(null)).toBe(100);
  });

  it("keeps stored values, including mute", () => {
    expect(parseStoredVolumePct("42")).toBe(42);
    expect(parseStoredVolumePct("0")).toBe(0);
  });

  it("clamps out-of-range values and ignores garbage", () => {
    expect(parseStoredVolumePct("150")).toBe(100);
    expect(parseStoredVolumePct("-5")).toBe(0);
    expect(parseStoredVolumePct("loud")).toBe(100);
  });
});
