// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEffectsClass,
  createFrameRateJudge,
  isLiteEffects,
  resolveStoredEffectsMode,
} from "./effects";

// Feeds frames at a steady gap and returns the first verdict, if any.
function run(judge: ReturnType<typeof createFrameRateJudge>, gapMs: number, forMs: number, from = 0) {
  for (let now = from; now <= from + forMs; now += gapMs) {
    const verdict = judge.push(now);
    if (verdict) {
      return { verdict, at: now };
    }
  }
  return null;
}

describe("createFrameRateJudge", () => {
  it("calls a page slow after two slow windows in a row", () => {
    // 21 frames a second, as the default style runs without a GPU.
    const result = run(createFrameRateJudge(), 48, 10_000);
    expect(result?.verdict).toBe("slow");
    expect(result?.at).toBeLessThan(4500);
  });

  it("calls a 60 Hz page fine and stops", () => {
    expect(run(createFrameRateJudge(), 16.7, 30_000)?.verdict).toBe("fine");
  });

  it("does not count a single slow window between good ones", () => {
    const judge = createFrameRateJudge();
    expect(run(judge, 16.7, 2100)).toBeNull();
    expect(run(judge, 40, 2100, 2200)).toBeNull();
    expect(run(judge, 16.7, 30_000, 4400)?.verdict).toBe("fine");
  });

  it("ignores the gap left by a hidden tab", () => {
    const judge = createFrameRateJudge();
    expect(run(judge, 16.7, 1500)).toBeNull();
    // Ten seconds away, then back at full speed.
    expect(run(judge, 16.7, 30_000, 11_500)?.verdict).toBe("fine");
  });

  it("ignores the occasional stutter", () => {
    const judge = createFrameRateJudge();
    let now = 0;
    let verdict = null;
    for (let i = 0; i < 2000 && !verdict; i += 1) {
      now += i % 20 === 0 ? 120 : 16.7;
      verdict = judge.push(now);
    }
    expect(verdict).toBe("fine");
  });
});

describe("effects mode", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.classList.remove("lite-effects");
  });

  it("is auto unless full or lite was chosen", () => {
    expect(resolveStoredEffectsMode()).toBe("auto");
    localStorage.setItem("fj-effects", "lite");
    expect(resolveStoredEffectsMode()).toBe("lite");
    localStorage.setItem("fj-effects", "nonsense");
    expect(resolveStoredEffectsMode()).toBe("auto");
  });

  it("is lite when chosen, or when auto found the page slow", () => {
    expect(isLiteEffects("lite", false)).toBe(true);
    expect(isLiteEffects("auto", true)).toBe(true);
    expect(isLiteEffects("auto", false)).toBe(false);
    // Full stays full even after auto once switched.
    expect(isLiteEffects("full", true)).toBe(false);
  });

  it("marks the body for the stylesheet", () => {
    applyEffectsClass(true);
    expect(document.body.classList.contains("lite-effects")).toBe(true);
    applyEffectsClass(false);
    expect(document.body.classList.contains("lite-effects")).toBe(false);
  });
});
