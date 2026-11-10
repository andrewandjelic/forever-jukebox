import { resampleStereo, type StereoChannels } from "./audioResample";
import { isInstrumentalModeAvailable } from "./instrumentalRenderer";
import type { BeatSpan, VocalMapData } from "./vocalMap";
import type { VocalMapResponse } from "./vocalMapWorker";

// Builds a track's vocal map in the background: separates the instrumental
// with the same model Instrumental mode uses, subtracts it from the mix to
// leave the vocals, and reads the map off those.
//
// The separation is always run fresh, at the separator's own sample rate. A
// stored instrumental will not do: it is a lossy copy that comes back a few
// frames off, and subtracting that leaves most of the song behind.

export type VocalMapProgress = {
  // "download": fetching the separation model (once); "separate": running
  // it; "map": reading the map off the vocals.
  phase: "download" | "separate" | "map";
  progress: number;
};

export type VocalMapJob = {
  promise: Promise<VocalMapData>;
  cancel: () => void;
};

type SeparationMessage =
  | { type: "progress"; phase: "download" | "separate"; progress: number }
  | { type: "result"; left: Float32Array; right: Float32Array }
  | { type: "error"; message: string };

const SEPARATOR_SAMPLE_RATE = 44_100;
export const VOCAL_MAP_CANCELLED = "Vocal map cancelled";

// Needs what Instrumental mode needs: WebGPU on a desktop browser.
export function canBuildVocalMaps(): boolean {
  return isInstrumentalModeAvailable();
}

export function startVocalMapJob(
  sourceBuffer: AudioBuffer,
  beats: BeatSpan[],
  onProgress: (progress: VocalMapProgress) => void,
): VocalMapJob {
  let cancelled = false;
  let worker: Worker | null = null;
  let downloading = false;
  let rejectStep: ((err: Error) => void) | null = null;

  const check = () => {
    if (cancelled) {
      throw new Error(VOCAL_MAP_CANCELLED);
    }
  };

  const separate = (mix: StereoChannels) =>
    new Promise<StereoChannels>((resolve, reject) => {
      const separator = new Worker(
        new URL("./instrumentalWorker.ts", import.meta.url),
        { type: "module" },
      );
      worker = separator;
      rejectStep = reject;
      separator.onmessage = (event: MessageEvent<SeparationMessage>) => {
        const message = event.data;
        if (message.type === "progress") {
          downloading = message.phase === "download" && message.progress < 1;
          onProgress({ phase: message.phase, progress: message.progress });
          return;
        }
        separator.terminate();
        worker = null;
        if (message.type === "result") {
          resolve([
            message.left as Float32Array<ArrayBuffer>,
            message.right as Float32Array<ArrayBuffer>,
          ]);
          return;
        }
        reject(new Error(message.message));
      };
      separator.onerror = (event) => {
        separator.terminate();
        worker = null;
        reject(new Error(event.message || "Separation worker failed to load"));
      };
      // The separator takes ownership of what it is sent; the mix is needed
      // again afterwards, so it gets copies.
      const left = mix[0].slice();
      const right = mix[1].slice();
      separator.postMessage(
        { type: "separate", left, right, sampleRate: SEPARATOR_SAMPLE_RATE },
        [left.buffer, right.buffer],
      );
    });

  const readMap = (mono: Float32Array, mixMono: Float32Array) =>
    new Promise<VocalMapData>((resolve, reject) => {
      const mapper = new Worker(new URL("./vocalMapWorker.ts", import.meta.url), {
        type: "module",
      });
      worker = mapper;
      rejectStep = reject;
      mapper.onmessage = (event: MessageEvent<VocalMapResponse>) => {
        mapper.terminate();
        worker = null;
        if (event.data.type === "result") {
          resolve(event.data.map);
        } else {
          reject(new Error(event.data.message));
        }
      };
      mapper.onerror = (event) => {
        mapper.terminate();
        worker = null;
        reject(new Error(event.message || "Vocal map worker failed to load"));
      };
      mapper.postMessage(
        { mono, mix: mixMono, sampleRate: SEPARATOR_SAMPLE_RATE, beats },
        [mono.buffer, mixMono.buffer],
      );
    });

  const run = async () => {
    const { numberOfChannels, sampleRate } = sourceBuffer;
    let mix: StereoChannels = [
      new Float32Array(sourceBuffer.getChannelData(0)),
      new Float32Array(sourceBuffer.getChannelData(numberOfChannels > 1 ? 1 : 0)),
    ];
    if (sampleRate !== SEPARATOR_SAMPLE_RATE) {
      mix = await resampleStereo(mix, sampleRate, SEPARATOR_SAMPLE_RATE);
      check();
    }
    const instrumental = await separate(mix);
    check();
    // The separator may return a few frames more or fewer than it was given.
    const frames = Math.min(mix[0].length, instrumental[0].length);
    const vocals = new Float32Array(frames);
    const mixMono = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      mixMono[i] = (mix[0][i] + mix[1][i]) / 2;
      vocals[i] = mixMono[i] - (instrumental[0][i] + instrumental[1][i]) / 2;
    }
    onProgress({ phase: "map", progress: 0 });
    const map = await readMap(vocals, mixMono);
    check();
    return map;
  };

  return {
    promise: run(),
    cancel: () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      const running = worker;
      worker = null;
      if (running) {
        if (downloading) {
          // Let a model download finish and be stored; drop the worker as
          // soon as it reports anything else.
          running.onmessage = (event: MessageEvent<SeparationMessage>) => {
            const message = event.data;
            if (
              message.type !== "progress" ||
              message.phase !== "download" ||
              message.progress >= 1
            ) {
              running.terminate();
            }
          };
          running.onerror = () => running.terminate();
        } else {
          running.terminate();
        }
      }
      rejectStep?.(new Error(VOCAL_MAP_CANCELLED));
    },
  };
}
