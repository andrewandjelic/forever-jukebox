import type { QuantumBase } from "@forever-jukebox/shared/types";
import { getAppContext } from "./runtime";
import { useAppStore } from "./store";

// Beat "pound" for styles that throb with the music (Doom pounds, Moth blooms).
// While a song plays in Jukebox mode it writes two CSS variables on
// #jukebox-viz, both 0..1:
// --pound kicks on every beat and dies away within a fraction of it, harder on
// louder beats; --pound-bar does the same on the first beat of each bar only.
// The style's CSS decides what they do (Doom: a punch, a drop and a red flash).

// How fast a pound dies away by default: down to a third after this many
// seconds. Styles can pass a slower decay for a softer swell.
export const DEFAULT_DECAY_SECONDS = 0.12;

// Louder beats pound harder: a beat's peak loudness from a quiet -30 dB (a
// light tap) up to a mastered -4 dB (full force). Unknown loudness pounds at
// a medium strength.
export function beatStrength(loudnessDb: number | null) {
  if (loudnessDb === null || !Number.isFinite(loudnessDb)) {
    return 0.6;
  }
  return Math.min(1, Math.max(0.2, (loudnessDb + 30) / 26));
}

// The pound `seconds` after a beat that hit with `strength`.
export function poundEnvelope(
  seconds: number,
  strength: number,
  decaySeconds = DEFAULT_DECAY_SECONDS,
) {
  return seconds < 0 ? 0 : strength * Math.exp(-seconds / decaySeconds);
}

export function beatLoudness(beat: QuantumBase): number | null {
  let loudest: number | null = null;
  for (const segment of beat.overlappingSegments ?? []) {
    if (loudest === null || segment.loudness_max > loudest) {
      loudest = segment.loudness_max;
    }
  }
  return loudest;
}

function currentPound(): { pound: number; bar: number } {
  const { player, engine } = getAppContext();
  if (!player.isPlaying() || useAppStore.getState().playMode !== "jukebox") {
    return { pound: 0, bar: 0 };
  }
  const time = player.getCurrentTime();
  const beat = engine.getBeatAtTime(time);
  if (!beat) {
    return { pound: 0, bar: 0 };
  }
  const seconds = (time - beat.start) / player.getPlaybackRate();
  const pound = poundEnvelope(seconds, beatStrength(beatLoudness(beat)), decay);
  return { pound, bar: beat.indexInParent === 0 ? pound : 0 };
}

let rafId = 0;
let decay = DEFAULT_DECAY_SECONDS;
let written = { target: null as HTMLElement | null, pound: -1, bar: -1 };

function write(target: HTMLElement, pound: number, bar: number) {
  // Skip near-identical values so a paused or quiet song doesn't restyle
  // the visualizer every frame.
  if (
    target === written.target &&
    Math.abs(pound - written.pound) < 0.005 &&
    Math.abs(bar - written.bar) < 0.005
  ) {
    return;
  }
  target.style.setProperty("--pound", pound.toFixed(3));
  target.style.setProperty("--pound-bar", bar.toFixed(3));
  written = { target, pound, bar };
}

function frame() {
  rafId = requestAnimationFrame(frame);
  const target = document.getElementById("jukebox-viz");
  if (target) {
    const { pound, bar } = currentPound();
    write(target, pound, bar);
  }
}

export function startBeatPound(decaySeconds = DEFAULT_DECAY_SECONDS) {
  decay = decaySeconds;
  if (!rafId) {
    rafId = requestAnimationFrame(frame);
  }
}

export function stopBeatPound() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  written = { target: null, pound: -1, bar: -1 };
  const target = document.getElementById("jukebox-viz");
  target?.style.removeProperty("--pound");
  target?.style.removeProperty("--pound-bar");
}
