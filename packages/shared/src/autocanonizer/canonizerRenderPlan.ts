import type { CanonizerBeat } from "./AutocanonizerViz";

// Share of the mix given to the main voice; the other voice gets the rest.
export const CANONIZER_MASTER_BLEND = 0.55;
// Seconds the other voice may drift from the main beats before it resyncs.
export const CANONIZER_MAX_SKEW_DELTA = 0.05;

export type CanonizerRenderSegment = {
  outputStart: number;
  duration: number;
  // Source position minus output time; constant until the voice restarts.
  sourceOffset: number;
  gain: number;
};

export type CanonizerRenderVoice = {
  pan: number;
  segments: CanonizerRenderSegment[];
};

export type CanonizerRenderPlan = {
  durationSeconds: number;
  voices: CanonizerRenderVoice[];
};

// One pass of the canon from the first beat, timed as playback on an exact clock.
export function planCanonizerRender(
  beats: CanonizerBeat[],
  options: { finishOutSong: boolean; mainPan: number; otherPan: number },
): CanonizerRenderPlan | null {
  if (!beats.length) {
    return null;
  }
  const finalIndex = beats.length - 1;
  const mainOffset = beats[0].start;
  const other: CanonizerRenderSegment[] = [];
  const otherGain = (beat: CanonizerBeat) =>
    (1 - CANONIZER_MASTER_BLEND) * Math.max(0, Math.min(1, beat.otherGain));
  let time = 0;
  let otherOffset = 0;
  let skew = 0;
  let previous: CanonizerBeat | null = null;

  for (let index = 0; index <= finalIndex; index += 1) {
    // Finishing out stops the main voice as the final beat begins.
    if (options.finishOutSong && index === finalIndex) {
      break;
    }
    const beat = beats[index];
    if (
      previous?.other.next !== beat.other ||
      Math.abs(skew) > CANONIZER_MAX_SKEW_DELTA
    ) {
      skew = 0;
      otherOffset = beat.other.start - time;
    }
    skew += beat.duration - beat.other.duration;
    const duration = Math.max(
      0,
      beat.start + beat.duration - (time + mainOffset),
    );
    other.push({
      outputStart: time,
      duration,
      sourceOffset: otherOffset,
      gain: otherGain(beat),
    });
    time += duration;
    previous = beat;
  }

  const main: CanonizerRenderSegment[] = [
    {
      outputStart: 0,
      duration: time,
      sourceOffset: mainOffset,
      gain: CANONIZER_MASTER_BLEND,
    },
  ];

  if (options.finishOutSong) {
    // The other voice alone plays on from the final beat's partner to the end.
    let current = beats[finalIndex];
    for (let index = current.other.which; index <= finalIndex; index += 1) {
      const beat = beats[index];
      if (current.other.next !== beat) {
        otherOffset = beat.start - time;
      }
      const duration = Math.max(
        0,
        beat.start + beat.duration - (time + otherOffset),
      );
      other.push({
        outputStart: time,
        duration,
        sourceOffset: otherOffset,
        gain: otherGain(beat),
      });
      time += duration;
      current = beat;
    }
  }

  return {
    durationSeconds: time,
    voices: [
      { pan: options.mainPan, segments: main },
      { pan: options.otherPan, segments: other },
    ],
  };
}
