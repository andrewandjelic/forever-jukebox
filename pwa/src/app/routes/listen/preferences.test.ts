import { beforeEach, describe, expect, it } from "vitest";
import { resolveStoredVolume, storeVolume } from "./preferences";

describe("volume preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to full volume when storage is empty", () => {
    expect(resolveStoredVolume()).toBe(100);
  });

  it("persists and reads the volume, including mute", () => {
    storeVolume(42);
    expect(localStorage.getItem("fj-volume")).toBe("42");
    expect(resolveStoredVolume()).toBe(42);
    storeVolume(0);
    expect(resolveStoredVolume()).toBe(0);
  });
});
