import { createFft } from "./fft";

// Builds a track's vocal map from its isolated vocals: for each beat, what the
// singer is doing where the beat starts, whether there is singing during it,
// and a short print of the voice's spectrum on either side. The jump engine
// reads the result (see engine/vocals.ts) to keep sung lines whole.

// The map as the analysis carries it: a state digit and a sung digit per
// beat, and the prints as base64.
export type VocalMapData = {
  version: 1;
  state: string;
  sung: string;
  print: string;
};

export type BeatSpan = { start: number; duration: number };

const FFT_SIZE = 1024;
const FRAME_SECONDS = 0.01;
// Where a voice carries its energy, for telling singing from silence.
const VOICE_LOW_HZ = 150;
const VOICE_HIGH_HZ = 6000;
// A frame counts as singing within this many dB of the track's loud singing
// (the 95th percentile of the voice's level).
const ACTIVE_FLOOR_DB = -24;
// ...and no quieter than this far under the full mix's loud level. A song with
// no singing still leaves a faint residue in the separated "vocals"; measured
// against itself that residue would count as singing all the way through.
const VOICE_UNDER_MIX_DB = 30;
// The mix's level is only wanted roughly, so every fourth frame will do.
const MIX_FRAME_STRIDE = 4;
// Singing is judged just before and just after a beat's start, leaving out
// the few hundredths of a second around it where a note may be changing.
const SIDE_GUARD_SECONDS = 0.02;
const SIDE_REACH_SECONDS = 0.13;
// With singing on both sides, a burst of new spectral energy this close to
// the boundary is a new syllable; without one it is a held note.
const ONSET_WINDOW_SECONDS = 0.07;
const ONSET_FLUX_RATIO = 2.5;
const ACTIVE_SHARE = 0.5;

// The print: the voice's level in bands from 100 Hz to 8 kHz, averaged over a
// short stretch each side of the boundary, in half-dB steps above a floor
// PRINT_RANGE_DB under the track's loudest band.
export const PRINT_BANDS = 36;
const PRINT_LOW_HZ = 100;
const PRINT_HIGH_HZ = 8000;
const PRINT_FROM_SECONDS = 0.02;
const PRINT_TO_SECONDS = 0.14;
const PRINT_RANGE_DB = 70;

const GAP = 0;
const START = 1;
const END = 2;
const ONSET = 3;
const SUSTAINED = 4;

type Frames = {
  count: number;
  // Frame centers in seconds.
  times: Float64Array;
  // Level of the voice band per frame, dB.
  energyDb: Float64Array;
  // Rise in the voice band's log spectrum since the frame before.
  flux: Float64Array;
  // PRINT_BANDS levels per frame, dB, row-major by frame.
  bandDb: Float64Array;
};

// First index whose time is at or past `value`.
function lowerBound(times: Float64Array, value: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function analyzeFrames(mono: Float32Array, sampleRate: number): Frames {
  const hop = Math.round(sampleRate * FRAME_SECONDS);
  const count = mono.length >= FFT_SIZE ? Math.floor((mono.length - FFT_SIZE) / hop) + 1 : 0;
  const bins = FFT_SIZE / 2 + 1;
  const binHz = sampleRate / FFT_SIZE;
  const fft = createFft(FFT_SIZE);
  const window = new Float64Array(FFT_SIZE);
  let windowSum = 0;
  for (let i = 0; i < FFT_SIZE; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
    windowSum += window[i];
  }
  const voiceFrom = Math.ceil(VOICE_LOW_HZ / binHz);
  const voiceTo = Math.min(bins - 1, Math.floor(VOICE_HIGH_HZ / binHz));
  // Which print band each bin feeds, or -1.
  const bandOf = new Int16Array(bins).fill(-1);
  const ratio = Math.pow(PRINT_HIGH_HZ / PRINT_LOW_HZ, 1 / PRINT_BANDS);
  for (let bin = 0; bin < bins; bin += 1) {
    const hz = bin * binHz;
    if (hz >= PRINT_LOW_HZ && hz < PRINT_HIGH_HZ) {
      const band = Math.floor(Math.log(hz / PRINT_LOW_HZ) / Math.log(ratio));
      bandOf[bin] = Math.min(PRINT_BANDS - 1, Math.max(0, band));
    }
  }

  const times = new Float64Array(count);
  const energyDb = new Float64Array(count);
  const flux = new Float64Array(count);
  const bandDb = new Float64Array(count * PRINT_BANDS);
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  const voiceBins = Math.max(0, voiceTo - voiceFrom + 1);
  let previousLog = new Float64Array(voiceBins);
  let currentLog = new Float64Array(voiceBins);
  const bandPower = new Float64Array(PRINT_BANDS);

  for (let frame = 0; frame < count; frame += 1) {
    const offset = frame * hop;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      real[i] = mono[offset + i] * window[i];
      imag[i] = 0;
    }
    fft.transform(real, imag);
    times[frame] = (offset + FFT_SIZE / 2) / sampleRate;
    bandPower.fill(0);
    let voicePower = 0;
    let rise = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const re = real[bin] / windowSum;
      const im = imag[bin] / windowSum;
      const power = re * re + im * im;
      const band = bandOf[bin];
      if (band >= 0) {
        bandPower[band] += power;
      }
      if (bin >= voiceFrom && bin <= voiceTo) {
        voicePower += power;
        const log = Math.log1p(50 * Math.sqrt(power));
        currentLog[bin - voiceFrom] = log;
        if (frame > 0 && log > previousLog[bin - voiceFrom]) {
          rise += log - previousLog[bin - voiceFrom];
        }
      }
    }
    energyDb[frame] = 10 * Math.log10(voicePower + 1e-12);
    flux[frame] = rise;
    for (let band = 0; band < PRINT_BANDS; band += 1) {
      bandDb[frame * PRINT_BANDS + band] = 10 * Math.log10(bandPower[band] + 1e-10);
    }
    const swap = previousLog;
    previousLog = currentLog;
    currentLog = swap;
  }
  return { count, times, energyDb, flux, bandDb };
}

// Level of the voice band in each frame of `mono`, dB, taking every
// `stride`th frame.
function voiceBandLevels(mono: Float32Array, sampleRate: number, stride: number): Float64Array {
  const hop = Math.round(sampleRate * FRAME_SECONDS) * stride;
  const count = mono.length >= FFT_SIZE ? Math.floor((mono.length - FFT_SIZE) / hop) + 1 : 0;
  const binHz = sampleRate / FFT_SIZE;
  const from = Math.ceil(VOICE_LOW_HZ / binHz);
  const to = Math.min(FFT_SIZE / 2, Math.floor(VOICE_HIGH_HZ / binHz));
  const fft = createFft(FFT_SIZE);
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  const levels = new Float64Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    const offset = frame * hop;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      real[i] = mono[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
      imag[i] = 0;
    }
    fft.transform(real, imag);
    let power = 0;
    for (let bin = from; bin <= to; bin += 1) {
      power += real[bin] * real[bin] + imag[bin] * imag[bin];
    }
    // Scaled like analyzeFrames: by the window's sum, which is half its size.
    levels[frame] = 10 * Math.log10(power / (FFT_SIZE / 2) ** 2 + 1e-12);
  }
  return levels;
}

// How loud the voice band of a full mix gets (its 95th percentile, dB): the
// yardstick a separated vocal is held against.
export function mixLoudnessDb(mix: Float32Array, sampleRate: number): number {
  return percentile(voiceBandLevels(mix, sampleRate, MIX_FRAME_STRIDE), 0.95);
}

// The value a share `p` of the way through the sorted values, interpolated.
function percentile(values: Float64Array, p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = Float64Array.from(values).sort();
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function shareActive(active: Uint8Array, from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  let sum = 0;
  for (let i = from; i < to; i += 1) {
    sum += active[i];
  }
  return sum / (to - from);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// `mono` is the isolated vocals (both channels averaged) at `sampleRate`.
// `mixLoudDb` is mixLoudnessDb() of the song they were separated from; without
// it the vocals are only measured against themselves.
export function buildVocalMap(
  mono: Float32Array,
  sampleRate: number,
  beats: BeatSpan[],
  mixLoudDb: number | null = null,
): VocalMapData {
  const { count, times, energyDb, flux, bandDb } = analyzeFrames(mono, sampleRate);

  const loud = percentile(energyDb, 0.95);
  const floor = Math.max(
    loud + ACTIVE_FLOOR_DB,
    mixLoudDb === null ? -Infinity : mixLoudDb - VOICE_UNDER_MIX_DB,
  );
  const active = new Uint8Array(count);
  const activeFlux: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    if (energyDb[frame] > floor) {
      active[frame] = 1;
      activeFlux.push(flux[frame]);
    }
  }
  activeFlux.sort((a, b) => a - b);
  const middle = activeFlux.length >> 1;
  const medianFlux =
    activeFlux.length === 0
      ? 0
      : activeFlux.length % 2 === 1
        ? activeFlux[middle]
        : (activeFlux[middle - 1] + activeFlux[middle]) / 2;
  const onsetFlux = medianFlux * ONSET_FLUX_RATIO;

  let peakDb = -Infinity;
  for (let i = 0; i < bandDb.length; i += 1) {
    if (bandDb[i] > peakDb) {
      peakDb = bandDb[i];
    }
  }
  const floorDb = peakDb - PRINT_RANGE_DB;

  const width = PRINT_BANDS * 2;
  const print = new Uint8Array(beats.length * width);
  // Mean level of each band over frames [from, to), written as bytes; an
  // empty range falls back to one frame, as at the very start or end.
  const writePrint = (target: number, from: number, to: number, fallback: number) => {
    for (let band = 0; band < PRINT_BANDS; band += 1) {
      let level = 0;
      if (count === 0) {
        level = floorDb;
      } else if (to > from) {
        for (let frame = from; frame < to; frame += 1) {
          level += Math.max(floorDb, bandDb[frame * PRINT_BANDS + band]);
        }
        level /= to - from;
      } else {
        level = Math.max(floorDb, bandDb[fallback * PRINT_BANDS + band]);
      }
      print[target + band] = Math.min(255, Math.max(0, Math.round((level - floorDb) * 2)));
    }
  };

  let state = "";
  let sung = "";
  beats.forEach((beat, index) => {
    const at = beat.start;
    const before = shareActive(
      active,
      lowerBound(times, at - SIDE_REACH_SECONDS),
      lowerBound(times, at - SIDE_GUARD_SECONDS),
    );
    const after = shareActive(
      active,
      lowerBound(times, at + SIDE_GUARD_SECONDS),
      lowerBound(times, at + SIDE_REACH_SECONDS),
    );
    let peak = 0;
    const onsetTo = lowerBound(times, at + ONSET_WINDOW_SECONDS);
    for (let frame = lowerBound(times, at - ONSET_WINDOW_SECONDS); frame < onsetTo; frame += 1) {
      peak = Math.max(peak, flux[frame]);
    }
    let boundary = SUSTAINED;
    if (before < ACTIVE_SHARE && after < ACTIVE_SHARE) {
      boundary = GAP;
    } else if (before < ACTIVE_SHARE) {
      boundary = START;
    } else if (after < ACTIVE_SHARE) {
      boundary = END;
    } else if (peak >= onsetFlux) {
      boundary = ONSET;
    }
    state += boundary;

    const from = lowerBound(times, beat.start);
    const to = lowerBound(times, beat.start + beat.duration);
    sung += to > from && shareActive(active, from, to) >= ACTIVE_SHARE ? "1" : "0";

    writePrint(
      index * width,
      lowerBound(times, at - PRINT_TO_SECONDS),
      lowerBound(times, at - PRINT_FROM_SECONDS),
      0,
    );
    writePrint(
      index * width + PRINT_BANDS,
      lowerBound(times, at + PRINT_FROM_SECONDS),
      lowerBound(times, at + PRINT_TO_SECONDS),
      Math.max(0, count - 1),
    );
  });

  return { version: 1, state, sung, print: toBase64(print) };
}
