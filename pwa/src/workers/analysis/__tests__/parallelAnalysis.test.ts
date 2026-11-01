import { afterEach, describe, expect, it, vi } from "vitest";
import { beatWorkerCount } from "../beatDetection";
import { frameCount, frameRuns } from "../essentiaFrames";

describe("frame runs", () => {
  const config = { frameSize: 2048, hopSize: 512, sampleRate: 22050 };

  it("covers every frame once, with each frame's own samples", () => {
    for (const sampleCount of [100, 2048, 2049, 22050 * 7 + 13]) {
      for (const workers of [1, 3, 4, 50]) {
        const runs = frameRuns(sampleCount, config, workers);
        expect(runs.length).toBeLessThanOrEqual(workers);
        let next = 0;
        for (const run of runs) {
          expect(run.first).toBe(next);
          next += run.count;
          for (let i = run.first; i < run.first + run.count; i += 1) {
            // The worker frames samples.subarray(local, local + frameSize) of
            // its chunk; that must be the same window as on the whole track.
            const local = (i - run.first) * config.hopSize;
            const fromChunk = Math.min(run.end - run.start, local + config.frameSize) - local;
            const globalStart = i * config.hopSize;
            const fromTrack = Math.min(sampleCount, globalStart + config.frameSize) - globalStart;
            expect(run.start + local).toBe(globalStart);
            expect(fromChunk).toBe(fromTrack);
          }
        }
        expect(next).toBe(frameCount(sampleCount, config));
      }
    }
  });
});

describe("beat worker count", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const device = (threads: number, deviceMemory?: number) =>
    vi.stubGlobal("navigator", { hardwareConcurrency: threads, deviceMemory });

  it("uses half the threads, up to the eight networks", () => {
    device(16, 8);
    expect(beatWorkerCount(240)).toBe(8);
    device(32, 8);
    expect(beatWorkerCount(240)).toBe(8);
    device(4, 8);
    expect(beatWorkerCount(240)).toBe(2);
    device(1, 8);
    expect(beatWorkerCount(240)).toBe(1);
  });

  it("uses fewer workers for long tracks on small devices", () => {
    device(16, 2);
    expect(beatWorkerCount(240)).toBe(3);
    expect(beatWorkerCount(1800)).toBe(1);
    // Browsers that don't report memory are treated as 4 GB.
    device(16);
    expect(beatWorkerCount(600)).toBe(3);
  });
});
