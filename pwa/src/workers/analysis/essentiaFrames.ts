// Essentia's per-frame features, spread over several workers in contiguous
// runs of frames, then the novelty-based segmentation. Each frame is computed
// from its own samples alone, so splitting the track changes nothing.
import type { FrameFeatures } from "../essentia.worker";
import { zscore1d, zscore2d } from "../essentia/math";
import { computeSegments, segmentFromNovelty } from "../essentia/segments";
import type { Segment, SegmentationConfig } from "../essentia/segments";
import { hardwareThreads, WorkerChannel } from "./workerChannel";

export type FrameConfig = {
  frameSize: number;
  hopSize: number;
  sampleRate: number;
};

export type TrackFrames = FrameFeatures & {
  frameTimes: Float32Array;
  // Duration of the samples the frames came from.
  duration: number;
};

const MAX_WORKERS = 4;

// A quarter of the threads: beat detection takes most of the rest.
export function essentiaWorkerCount(): number {
  return Math.max(1, Math.min(MAX_WORKERS, Math.floor(hardwareThreads() / 4)));
}

export function frameCount(sampleCount: number, config: FrameConfig) {
  return Math.max(
    1,
    Math.floor(Math.max(sampleCount - config.frameSize, 0) / config.hopSize) + 1,
  );
}

export type FrameRun = {
  first: number;
  count: number;
  // The samples covering the run: its first frame's start to its last
  // frame's end (or the track's end).
  start: number;
  end: number;
};

// Splits a track's frames into contiguous runs, one per worker.
export function frameRuns(sampleCount: number, config: FrameConfig, workers: number): FrameRun[] {
  const frames = frameCount(sampleCount, config);
  const runs = Math.max(1, Math.min(workers, frames));
  const perRun = Math.ceil(frames / runs);
  const out: FrameRun[] = [];
  for (let first = 0; first < frames; first += perRun) {
    const count = Math.min(perRun, frames - first);
    out.push({
      first,
      count,
      start: first * config.hopSize,
      end: Math.min(sampleCount, (first + count - 1) * config.hopSize + config.frameSize),
    });
  }
  return out;
}

export async function extractFrames(options: {
  samples: Float32Array;
  config: FrameConfig;
  workers: number;
  describeError: (message: string) => Error;
  onProgress?: (progress: number) => void;
}): Promise<TrackFrames> {
  const { samples, config, describeError, onProgress } = options;
  const { frameSize, hopSize, sampleRate } = config;
  const frames = frameCount(samples.length, config);
  const runs = frameRuns(samples.length, config, options.workers);

  const done = new Array(runs.length).fill(0);
  const results = await Promise.all(
    runs.map(async (run, r) => {
      const chunk = samples.slice(run.start, run.end);
      const worker = new WorkerChannel(
        new Worker(new URL("../essentia.worker.ts", import.meta.url), { type: "module" }),
        describeError,
      );
      try {
        return await worker.request<FrameFeatures>(
          { type: "frames", samples: chunk, sampleRate, frameSize, hopSize, frameCount: run.count },
          [chunk.buffer],
          (event) => {
            if (event.type === "progress") {
              done[r] = event.frames;
              onProgress?.(done.reduce((a, b) => a + b, 0) / frames);
            }
          },
        );
      } finally {
        worker.terminate();
      }
    }),
  );

  const frameTimes = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    frameTimes[i] = (i * hopSize) / sampleRate;
  }
  return {
    mfccs: results.flatMap((result) => result.mfccs),
    hpcps: results.flatMap((result) => result.hpcps),
    rmsDb: results.flatMap((result) => result.rmsDb),
    frameTimes,
    duration: samples.length / sampleRate,
  };
}

// Segments from the frames' novelty, snapped to the beats.
export function segmentFrames(
  track: TrackFrames,
  beats: number[],
  segmentation: SegmentationConfig,
): Segment[] {
  const { mfccs, hpcps, rmsDb, frameTimes, duration } = track;
  const frames = frameTimes.length;
  const mfccNorm = zscore2d(mfccs);
  const hpcpNorm = zscore2d(hpcps);
  const rmsNorm = zscore1d(rmsDb);
  const novelty = new Float32Array(frames);
  novelty[0] = 0;
  for (let i = 1; i < frames; i += 1) {
    let sum = 0;
    const prevMfcc = Array.from(mfccNorm[i - 1] ?? []);
    const prevHpcp = Array.from(hpcpNorm[i - 1] ?? []);
    const curMfcc = Array.from(mfccNorm[i] ?? []);
    const curHpcp = Array.from(hpcpNorm[i] ?? []);
    const vecPrev = prevMfcc.concat(prevHpcp, [rmsNorm[i - 1]]);
    const vecCur = curMfcc.concat(curHpcp, [rmsNorm[i]]);
    for (let j = 0; j < vecCur.length; j += 1) {
      const delta = vecCur[j] - vecPrev[j];
      sum += delta * delta;
    }
    novelty[i] = Math.sqrt(sum);
  }

  const boundaries = segmentFromNovelty(frameTimes, novelty, beats, segmentation, duration);
  return computeSegments(frameTimes, mfccs, hpcps, rmsDb, novelty, boundaries);
}
