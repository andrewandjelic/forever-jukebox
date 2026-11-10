import type { AppContext } from "./context";

// How much visual flourish the page draws. "auto" starts with everything and
// steps down to lite when the page cannot keep up; Settings can pin either.
// Lite drops the effects that cost the most on a machine with weak graphics:
// blurred glass panels, blended overlays, drifting backdrops, canvas glows.
export type EffectsMode = "auto" | "full" | "lite";
export const EFFECTS_MODES: readonly EffectsMode[] = ["auto", "full", "lite"];

const storageKey = "fj-effects";
// Auto's verdict lasts for the tab's lifetime, so a machine that was only
// busy for a moment gets the full look back on its next visit.
const autoLiteKey = "fj-effects-auto-lite";

export function resolveStoredEffectsMode(): EffectsMode {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "full" || stored === "lite" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function hasAutoSwitchedToLite(): boolean {
  try {
    return sessionStorage.getItem(autoLiteKey) === "1";
  } catch {
    return false;
  }
}

export function markAutoSwitchedToLite() {
  try {
    sessionStorage.setItem(autoLiteKey, "1");
  } catch {
    // Without session storage the verdict simply lasts until reload.
  }
}

export function isLiteEffects(mode: EffectsMode, autoLite: boolean): boolean {
  return mode === "lite" || (mode === "auto" && autoLite);
}

// The body class is what the stylesheet and the visualizer key on.
export function applyEffectsClass(lite: boolean) {
  document.body.classList.toggle("lite-effects", lite);
}

export function applyEffectsMode(
  context: AppContext | null,
  mode: EffectsMode,
  autoLite: boolean,
) {
  applyEffectsClass(isLiteEffects(mode, autoLite));
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // The choice still holds for this visit.
  }
  context?.jukebox?.refresh();
}

// Frames are judged in windows by their median gap, so one stutter does not
// count. A 60 Hz screen gives 16.7 ms; 28 ms is under about 36 frames a second.
const WINDOW_MS = 2000;
const SLOW_FRAME_MS = 28;
// A gap this long is the tab being hidden or the machine stalling, not the
// page's steady pace.
const MAX_GAP_MS = 250;
const SLOW_WINDOWS_TO_SWITCH = 2;
const FINE_WINDOWS_TO_STOP = 5;

export type FrameVerdict = "slow" | "fine";

// Feed it each frame's timestamp; it answers once: "slow" after two slow
// windows in a row, or "fine" after five good ones.
export function createFrameRateJudge() {
  let last: number | null = null;
  let windowStart = 0;
  let gaps: number[] = [];
  let slowRun = 0;
  let fineWindows = 0;

  const reset = () => {
    last = null;
    gaps = [];
  };

  return {
    // Call when frames stop counting (paused, hidden) so the gap is not judged.
    reset,
    push(now: number): FrameVerdict | null {
      if (last === null) {
        last = now;
        windowStart = now;
        return null;
      }
      const gap = now - last;
      last = now;
      if (gap > MAX_GAP_MS) {
        gaps = [];
        windowStart = now;
        return null;
      }
      gaps.push(gap);
      if (now - windowStart < WINDOW_MS) {
        return null;
      }
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      gaps = [];
      windowStart = now;
      if (median > SLOW_FRAME_MS) {
        slowRun += 1;
        return slowRun >= SLOW_WINDOWS_TO_SWITCH ? "slow" : null;
      }
      slowRun = 0;
      fineWindows += 1;
      return fineWindows >= FINE_WINDOWS_TO_STOP ? "fine" : null;
    },
  };
}

// Watches the page's frame pace while `isActive` says the visualizer is
// drawing, and calls `onSlow` once if it cannot keep up. Returns a stop
// function; the watch also stops by itself once the page proves fine.
export function watchFrameRate(isActive: () => boolean, onSlow: () => void) {
  const judge = createFrameRateJudge();
  let rafId = 0;
  const frame = (now: number) => {
    if (document.hidden || !isActive()) {
      judge.reset();
      rafId = requestAnimationFrame(frame);
      return;
    }
    const verdict = judge.push(now);
    if (verdict === "slow") {
      rafId = 0;
      onSlow();
      return;
    }
    if (verdict === "fine") {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  return () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
