import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import { cancelAutoplay, consumeAutoplay, requestAutoplay } from "./autoplay";

describe("autoplay", () => {
  beforeEach(() => {
    cancelAutoplay();
  });

  it("is not wanted unless a song was picked", () => {
    expect(consumeAutoplay()).toBe(false);
  });

  it("answers yes once per pick", () => {
    requestAutoplay();
    expect(consumeAutoplay()).toBe(true);
    expect(consumeAutoplay()).toBe(false);
  });

  it("forgets a pick whose load failed", () => {
    requestAutoplay();
    cancelAutoplay();
    expect(consumeAutoplay()).toBe(false);
  });

  it("forgets a pick that never finished loading", () => {
    requestAutoplay();
    expect(consumeAutoplay(Date.now() + 16 * 60 * 1000)).toBe(false);
  });

  it("wakes the audio output inside the click", () => {
    const resume = vi.fn(async () => undefined);
    const context = {
      player: { getContext: () => ({ resume }) },
    } as unknown as AppContext;
    requestAutoplay(context);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
