import {
  buildVocalMap,
  mixLoudnessDb,
  type BeatSpan,
  type VocalMapData,
} from "./vocalMap";

// Turns isolated vocals into a vocal map off the main thread: a few thousand
// FFTs per minute of audio would otherwise stall the page for a moment.

export type VocalMapRequest = {
  // The isolated vocals and the mix they came from, each as one channel.
  mono: Float32Array;
  mix: Float32Array;
  sampleRate: number;
  beats: BeatSpan[];
};

export type VocalMapResponse =
  | { type: "result"; map: VocalMapData }
  | { type: "error"; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<VocalMapRequest>) => void) | null;
  postMessage(message: VocalMapResponse): void;
};

// Falls back to globalThis so the module also loads outside a worker (tests).
const workerSelf = (
  typeof self === "undefined" ? globalThis : self
) as unknown as WorkerScope;

workerSelf.onmessage = (event) => {
  const { mono, mix, sampleRate, beats } = event.data;
  try {
    workerSelf.postMessage({
      type: "result",
      map: buildVocalMap(mono, sampleRate, beats, mixLoudnessDb(mix, sampleRate)),
    });
  } catch (err) {
    workerSelf.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
