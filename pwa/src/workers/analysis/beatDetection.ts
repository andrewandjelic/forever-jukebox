// Beat detection (madmom), spread over several workers: the features on one,
// the networks shared out, then each bar length decoded on its own. Every
// step does the same arithmetic as the engine's single-call analysis, so the
// beats are identical however many workers run.
import { hardwareThreads, WorkerChannel } from "./workerChannel";

export type MadmomResult = {
  fps: number;
  beat_times: number[];
  beat_numbers: number[];
  beat_confidences: number[];
};

export type BeatProgress = (stage: "features" | "inference" | "decode", progress: number) => void;

type FeaturesResult = {
  features: Float32Array;
  columns: number;
  networks: number;
  meters: number[];
};

type DecodeResult = {
  log_probability: number | null;
  output: MadmomResult | null;
};

const MAX_WORKERS = 8;
// Rough peak memory per network worker: the features (about 125 KB per second
// of audio) plus the network's working copies.
const WORKER_MB_PER_SECOND = 0.4;
const WORKER_BASE_MB = 40;

// How many workers to run the networks on: half the threads (the rest serve
// feature extraction and the page), fewer where a long track would strain a
// small device's memory.
export function beatWorkerCount(durationSec: number): number {
  const byThreads = Math.floor(hardwareThreads() / 2);
  // Chrome reports memory in GB (capped at 8); assume a modest 4 GB elsewhere.
  const deviceGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const perWorkerMb = WORKER_BASE_MB + durationSec * WORKER_MB_PER_SECOND;
  const byMemory = Math.floor((deviceGb * 1024) / 4 / perWorkerMb);
  return Math.max(1, Math.min(MAX_WORKERS, byThreads, byMemory));
}

function createWorker(describeError: (message: string) => Error) {
  const url = new URL(`${import.meta.env.BASE_URL}madmom/worker.js`, self.location.origin);
  return new WorkerChannel(new Worker(url, { type: "module" }), describeError);
}

export async function detectBeats(options: {
  samples: Float32Array;
  sampleRate: number;
  workers: number;
  describeError: (message: string) => Error;
  onProgress?: BeatProgress;
}): Promise<MadmomResult> {
  const { samples, sampleRate, describeError, onProgress } = options;
  const madmomStage = ["features", "inference", "decode"] as const;
  if (options.workers <= 1) {
    // One worker: the engine's single call, which keeps memory lowest.
    const worker = createWorker(describeError);
    try {
      return await worker.request<MadmomResult>(
        { type: "analyze", samples, sampleRate },
        [samples.buffer],
        (event) => {
          if (event.type === "progress") {
            onProgress?.(madmomStage[event.stage] ?? "features", event.progress);
          }
        },
      );
    } finally {
      worker.terminate();
    }
  }

  const workers = Array.from({ length: options.workers }, () => createWorker(describeError));
  // Every worker loads the engine and model while the first computes the
  // features. (A worker's requests run in order, so these go first.)
  workers.forEach((worker) => {
    worker.request({ type: "init" }).catch(() => undefined);
  });
  try {
    onProgress?.("features", 0);
    const { features, columns, networks, meters } = await workers[0].request<FeaturesResult>(
      { type: "features", samples, sampleRate },
      [samples.buffer],
    );
    onProgress?.("features", 1);
    // Before the features are handed (transferred) to the network workers.
    const frames = features.length / columns;

    // Deal the networks out round-robin; each busy worker gets its own copy
    // of the features.
    const groups = workers
      .map((worker, w) => ({
        worker,
        indices: Array.from({ length: networks }, (_, i) => i).filter((i) => i % workers.length === w),
      }))
      .filter((group) => group.indices.length > 0);
    let networksDone = 0;
    const outputs: Float32Array[] = new Array(networks);
    await Promise.all(
      groups.map(async ({ worker, indices }, g) => {
        const copy = g === groups.length - 1 ? features : features.slice();
        const result = await worker.request<{ outputs: Float32Array[] }>(
          { type: "networks", features: copy, columns, indices },
          [copy.buffer],
          (event) => {
            if (event.type === "network-done") {
              networksDone += 1;
              onProgress?.("inference", networksDone / networks);
            }
          },
        );
        indices.forEach((index, i) => {
          outputs[index] = result.outputs[i];
        });
      }),
    );

    const outputColumns = outputs[0].length / frames;
    const combined = new Float32Array(outputs.reduce((total, o) => total + o.length, 0));
    outputs.reduce((offset, o) => {
      combined.set(o, offset);
      return offset + o.length;
    }, 0);

    // Each bar length on its own worker; the first highest log probability
    // wins, as in the engine's single-call decode.
    const decodeProgress = meters.map(() => 0);
    const decoded = await Promise.all(
      meters.map((meter, m) => {
        const copy = combined.slice();
        return workers[m % workers.length].request<DecodeResult>(
          { type: "decode", outputs: copy, networks, columns: outputColumns, meter },
          [copy.buffer],
          (event) => {
            if (event.type === "progress") {
              decodeProgress[m] = event.progress;
              onProgress?.("decode", decodeProgress.reduce((a, b) => a + b, 0) / meters.length);
            }
          },
        );
      }),
    );
    let best: DecodeResult | null = null;
    for (const result of decoded) {
      if (
        result.log_probability !== null &&
        (best === null || result.log_probability > (best.log_probability as number))
      ) {
        best = result;
      }
    }
    if (!best?.output) {
      throw describeError("no bar length fits this track");
    }
    return best.output;
  } finally {
    workers.forEach((worker) => worker.terminate());
  }
}
