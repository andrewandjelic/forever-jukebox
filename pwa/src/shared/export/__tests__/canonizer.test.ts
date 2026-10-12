import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonizerRenderPlan } from "@forever-jukebox/shared/autocanonizer/canonizerRenderPlan";
import { renderCanonizerAudio } from "../canonizer";

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this.data = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }
  getChannelData(channel: number) {
    return this.data[channel] as Float32Array;
  }
}

const SAMPLE_RATE = 8000;

// One second per value: left carries the value, right carries its negative half.
function makeSource(values: number[]) {
  const buffer = new FakeAudioBuffer({
    numberOfChannels: 2,
    length: values.length * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });
  values.forEach((value, second) => {
    const from = second * SAMPLE_RATE;
    buffer.getChannelData(0).fill(value, from, from + SAMPLE_RATE);
    buffer.getChannelData(1).fill(-value / 2, from, from + SAMPLE_RATE);
  });
  return buffer as unknown as AudioBuffer;
}

function sampleAt(buffer: AudioBuffer, seconds: number) {
  const frame = Math.round(seconds * SAMPLE_RATE);
  return [buffer.getChannelData(0)[frame], buffer.getChannelData(1)[frame]];
}

function voice(pan: number, sourceOffset: number, gain: number, duration = 1) {
  return {
    pan,
    segments: [{ outputStart: 0, duration, sourceOffset, gain }],
  };
}

describe("renderCanonizerAudio", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  });

  it("sums the voices at their gains into a stereo buffer", async () => {
    const plan: CanonizerRenderPlan = {
      durationSeconds: 2,
      voices: [
        {
          pan: 0,
          segments: [{ outputStart: 0, duration: 2, sourceOffset: 0, gain: 0.5 }],
        },
        {
          pan: 0,
          segments: [
            { outputStart: 0, duration: 1, sourceOffset: 2, gain: 0.25 },
            { outputStart: 1, duration: 1, sourceOffset: -1, gain: 0.5 },
          ],
        },
      ],
    };

    const rendered = await renderCanonizerAudio(makeSource([0.2, 0.4, 0.8]), plan);

    expect(rendered.numberOfChannels).toBe(2);
    expect(rendered.length).toBe(2 * SAMPLE_RATE);
    expect(rendered.sampleRate).toBe(SAMPLE_RATE);
    const [left0, right0] = sampleAt(rendered, 0.5);
    expect(left0).toBeCloseTo(0.2 * 0.5 + 0.8 * 0.25);
    expect(right0).toBeCloseTo(-(0.2 * 0.5 + 0.8 * 0.25) / 2);
    const [left1] = sampleAt(rendered, 1.5);
    expect(left1).toBeCloseTo(0.4 * 0.5 + 0.2 * 0.5);
  });

  it("pans each voice like a stereo panner", async () => {
    const source = makeSource([0.8]);
    const render = async (pan: number) =>
      sampleAt(
        await renderCanonizerAudio(source, {
          durationSeconds: 1,
          voices: [voice(pan, 0, 1)],
        }),
        0.5,
      );

    const [centerLeft, centerRight] = await render(0);
    expect(centerLeft).toBeCloseTo(0.8);
    expect(centerRight).toBeCloseTo(-0.4);
    const [hardLeft, silentRight] = await render(-1);
    expect(hardLeft).toBeCloseTo(0.8 - 0.4);
    expect(silentRight).toBeCloseTo(0);
    const [silentLeft, hardRight] = await render(1);
    expect(silentLeft).toBeCloseTo(0);
    expect(hardRight).toBeCloseTo(-0.4 + 0.8);
    const [halfLeft, halfRight] = await render(0.5);
    expect(halfLeft).toBeCloseTo(0.8 * Math.cos(Math.PI / 4));
    expect(halfRight).toBeCloseTo(-0.4 + 0.8 * Math.sin(Math.PI / 4));
  });

  it("leaves silence where a voice runs past the end of the source", async () => {
    const rendered = await renderCanonizerAudio(makeSource([0.6, 0.6]), {
      durationSeconds: 3,
      voices: [voice(0, 1, 1, 3)],
    });

    expect(rendered.length).toBe(3 * SAMPLE_RATE);
    expect(sampleAt(rendered, 0.5)[0]).toBeCloseTo(0.6);
    expect(sampleAt(rendered, 1.5)[0]).toBe(0);
    expect(sampleAt(rendered, 2.5)[0]).toBe(0);
  });

  it("applies the gain and mixes long output in slices", async () => {
    const seconds = 70;
    const progress: number[] = [];

    const rendered = await renderCanonizerAudio(
      makeSource(new Array<number>(seconds).fill(0.8)),
      { durationSeconds: seconds, voices: [voice(0, 0, 0.5, seconds)] },
      { gain: 0.5, onProgress: (value) => progress.push(value) },
    );

    expect(progress).toHaveLength(3);
    expect(progress.at(-1)).toBe(1);
    for (const at of [0.5, 29.999, 30, 45, 60, 69.5]) {
      expect(sampleAt(rendered, at)[0]).toBeCloseTo(0.8 * 0.5 * 0.5);
    }
  });
});
