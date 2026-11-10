// A track's vocal map says what the singer is doing at each beat, so jumps can
// be kept from cutting through a sung line. It rides along in the analysis as
// an optional `vocals` object; a track without one plays exactly as before.

// What the singer is doing where a beat starts.
export const VOCAL_GAP = 0; // nobody singing on either side
export const VOCAL_START = 1; // singing begins here
export const VOCAL_END = 2; // singing stops here
export const VOCAL_ONSET = 3; // a new syllable starts mid-line
export const VOCAL_SUSTAINED = 4; // one held note runs through
const MAX_VOCAL_STATE = VOCAL_SUSTAINED;

// A print byte is half a decibel.
const PRINT_DB_PER_STEP = 0.5;
// Two beats count as the same sound when their prints differ by less than
// this share of the track's typical difference between unrelated beats.
const SAME_VOICE_RATIO = 0.16;
// Beats sampled on each side when estimating that typical difference.
const REFERENCE_SAMPLE = 72;

export interface VocalMap {
  // One VOCAL_* state per beat, for the boundary at the beat's start.
  state: Uint8Array;
  // 1 where there is singing during the beat.
  sung: Uint8Array;
  // The voice's spectrum just before and just after each beat's start:
  // `width` bytes per beat, the first half before and the second half after.
  print: Uint8Array;
  width: number;
  // Largest print distance, in dB, that still counts as the same sound.
  sameVoiceMax: number;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeDigits(value: unknown, length: number, max: number): Uint8Array | null {
  if (typeof value !== "string" || value.length !== length) {
    return null;
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const digit = value.charCodeAt(i) - 48;
    if (digit < 0 || digit > max) {
      return null;
    }
    out[i] = digit;
  }
  return out;
}

function halfDistance(
  print: Uint8Array,
  a: number,
  b: number,
  from: number,
  to: number,
): number {
  let sum = 0;
  for (let k = from; k < to; k += 1) {
    const delta = print[a + k] - print[b + k];
    sum += delta * delta;
  }
  return Math.sqrt(sum / (to - from)) * PRINT_DB_PER_STEP;
}

// How differently the voice sounds around two beats' starts, in dB: the
// before-halves and the after-halves are compared separately and averaged.
export function voiceDistance(map: VocalMap, beatA: number, beatB: number): number {
  const half = map.width / 2;
  const a = beatA * map.width;
  const b = beatB * map.width;
  return (
    (halfDistance(map.print, a, b, 0, half) +
      halfDistance(map.print, a, b, half, map.width)) /
    2
  );
}

// The typical distance between unrelated beats, from an even sample of pairs.
function referenceDistance(map: VocalMap): number {
  const count = map.state.length;
  const step = Math.max(1, Math.floor(count / REFERENCE_SAMPLE));
  const distances: number[] = [];
  for (let i = 0; i < count; i += step) {
    for (let j = i + step; j < count; j += step) {
      distances.push(voiceDistance(map, i, j));
    }
  }
  if (distances.length === 0) {
    return 0;
  }
  distances.sort((x, y) => x - y);
  return distances[Math.floor(distances.length / 2)];
}

// Reads the analysis's optional `vocals` object. Anything missing or
// malformed reads as no map, never as an error: the map only refines jumps.
export function parseVocalMap(value: unknown, beatCount: number): VocalMap | null {
  if (typeof value !== "object" || value === null || beatCount <= 0) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.print !== "string") {
    return null;
  }
  const state = decodeDigits(raw.state, beatCount, MAX_VOCAL_STATE);
  const sung = decodeDigits(raw.sung, beatCount, 1);
  const print = decodeBase64(raw.print);
  if (!state || !sung || !print || print.length === 0) {
    return null;
  }
  const width = print.length / beatCount;
  if (!Number.isInteger(width) || width < 2 || width % 2 !== 0) {
    return null;
  }
  const map: VocalMap = { state, sung, print, width, sameVoiceMax: 0 };
  map.sameVoiceMax = referenceDistance(map) * SAME_VOICE_RATIO;
  return map;
}

function isOpen(state: number): boolean {
  return state === VOCAL_GAP || state === VOCAL_START || state === VOCAL_END;
}

// A jump plays `destIndex` in place of `seedIndex`, so the audio is cut where
// the seed beat starts and resumes where the destination starts. It keeps
// sung lines whole when no singing runs through either point, or when the
// voice sounds the same at both (the same note in another chorus).
export function isVocalJumpAllowed(
  map: VocalMap,
  seedIndex: number,
  destIndex: number,
): boolean {
  if (isOpen(map.state[seedIndex]) && isOpen(map.state[destIndex])) {
    return true;
  }
  return voiceDistance(map, seedIndex, destIndex) <= map.sameVoiceMax;
}
