import { describe, expect, it } from "vitest";
import type { CanonizerBeat } from "./AutocanonizerViz";
import {
  planCanonizerRender,
  type CanonizerRenderSegment,
} from "./canonizerRenderPlan";

// Contiguous linked beats; `others[i]` is the index beat `i` is paired with.
function makeBeats(start: number, durations: number[], others: number[]) {
  let cursor = start;
  const beats = durations.map((duration, which) => {
    const beat = { which, start: cursor, duration, otherGain: 1 };
    cursor += duration;
    return beat as unknown as CanonizerBeat;
  });
  beats.forEach((beat, index) => {
    beat.prev = beats[index - 1] ?? null;
    beat.next = beats[index + 1] ?? null;
    beat.other = beats[others[index]];
  });
  return beats;
}

function expectSegments(
  actual: CanonizerRenderSegment[],
  expected: Array<[number, number, number, number]>,
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach(([outputStart, duration, sourceOffset, gain], index) => {
    expect(actual[index].outputStart).toBeCloseTo(outputStart);
    expect(actual[index].duration).toBeCloseTo(duration);
    expect(actual[index].sourceOffset).toBeCloseTo(sourceOffset);
    expect(actual[index].gain).toBeCloseTo(gain);
  });
}

const centered = { mainPan: 0, otherPan: 0 };

describe("planCanonizerRender", () => {
  it("returns null without beats", () => {
    expect(
      planCanonizerRender([], { finishOutSong: false, ...centered }),
    ).toBeNull();
  });

  it("plans one pass of both voices when not finishing out", () => {
    const beats = makeBeats(2, [1, 1, 1, 1], [2, 3, 0, 1]);
    beats[1].otherGain = 0.5;
    beats[2].otherGain = 0.5;

    const plan = planCanonizerRender(beats, {
      finishOutSong: false,
      mainPan: -0.5,
      otherPan: 0.25,
    });

    expect(plan?.durationSeconds).toBeCloseTo(4);
    expect(plan?.voices.map((voice) => voice.pan)).toEqual([-0.5, 0.25]);
    expectSegments(plan!.voices[0].segments, [[0, 4, 2, 0.55]]);
    // The other voice runs on through sequential partners and restarts at the jump.
    expectSegments(plan!.voices[1].segments, [
      [0, 1, 4, 0.45],
      [1, 1, 4, 0.225],
      [2, 1, 0, 0.225],
      [3, 1, 0, 0.45],
    ]);
  });

  it("ends the main voice at the final beat and plays the other voice out", () => {
    const beats = makeBeats(2, [1, 1, 1, 1], [2, 3, 0, 1]);
    beats[1].otherGain = 0.5;

    const plan = planCanonizerRender(beats, {
      finishOutSong: true,
      ...centered,
    });

    expect(plan?.durationSeconds).toBeCloseTo(6);
    expectSegments(plan!.voices[0].segments, [[0, 3, 2, 0.55]]);
    expectSegments(plan!.voices[1].segments, [
      [0, 1, 4, 0.45],
      [1, 1, 4, 0.225],
      [2, 1, 0, 0.45],
      // From the final beat's partner to the end of the track.
      [3, 1, 0, 0.225],
      [4, 1, 0, 0.45],
      [5, 1, 0, 0.45],
    ]);
  });

  it("resyncs the other voice once it drifts past the skew limit", () => {
    const beats = makeBeats(
      0,
      [1, 1, 1, 0.97, 0.97, 0.97],
      [3, 4, 5, 3, 4, 5],
    );

    const plan = planCanonizerRender(beats, {
      finishOutSong: false,
      ...centered,
    });

    const offsets = plan!.voices[1].segments.map(
      (segment) => segment.sourceOffset,
    );
    expect(offsets[0]).toBeCloseTo(3);
    expect(offsets[1]).toBeCloseTo(3);
    expect(offsets[2]).toBeCloseTo(2.94);
  });
});
