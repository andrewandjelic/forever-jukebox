// Copied from web/src/workers/essentia.worker.ts on 2026-02-11, reason: reuse essentia.js analysis worker.
// Computes the per-frame features (MFCC, HPCP, loudness) for a run of
// frames; analysis/essentiaFrames.ts spreads a track over several of these
// and segments the result.
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import wasmUrl from "essentia.js/dist/essentia-wasm.web.wasm?url";
import { maybeDeleteVector, vectorToArraySafe } from "./essentia/vectors";

type FramesMessage = {
  type: "frames";
  // Starts at this run's first frame.
  samples: Float32Array;
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  frameCount: number;
};

export type FrameFeatures = {
  mfccs: number[][];
  hpcps: number[][];
  rmsDb: number[];
};

const PROGRESS_EVERY_FRAMES = 32;

let essentiaInstance: any = null;

function ensureEssentia() {
  if (essentiaInstance) {
    return essentiaInstance;
  }
  EssentiaWASM.locateFile = () => wasmUrl;
  essentiaInstance = new Essentia(EssentiaWASM);
  return essentiaInstance;
}

self.onmessage = (event: MessageEvent<FramesMessage>) => {
  if (event.data?.type !== "frames") {
    return;
  }
  try {
    const essentia = ensureEssentia();
    const { samples, sampleRate: sr, frameSize, hopSize, frameCount } = event.data;
    const mfccs: number[][] = [];
    const hpcps: number[][] = [];
    const rmsDb: number[] = [];

    for (let i = 0; i < frameCount; i += 1) {
      const start = i * hopSize;
      const frame = new Float32Array(frameSize);
      frame.set(samples.subarray(start, start + frameSize));

      const frameVec = essentia.arrayToVector(frame);
      const windowed = essentia.Windowing(frameVec).frame;
      const spectrum = essentia.Spectrum(windowed, frameSize).spectrum;
      const mfcc = essentia.MFCC(
        spectrum,
        undefined,
        11025,
        frameSize / 2 + 1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        13
      ).mfcc;
      const peaks = essentia.SpectralPeaks(
        spectrum,
        1e-6,
        undefined,
        undefined,
        undefined,
        "magnitude"
      );
      let hpcp: unknown;
      if (typeof peaks.frequencies?.size === "function" && peaks.frequencies.size() === 0) {
        hpcp = new Float32Array(12);
      } else {
        hpcp = essentia.HPCP(
          peaks.frequencies,
          peaks.magnitudes,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          sr,
          12
        ).hpcp;
      }
      const rms = essentia.RMS(frameVec).rms;
      const rmsVal = 20 * Math.log10(rms + 1e-9);

      mfccs.push(vectorToArraySafe(essentia, mfcc));
      hpcps.push(vectorToArraySafe(essentia, hpcp));
      rmsDb.push(rmsVal);

      maybeDeleteVector(frameVec);
      maybeDeleteVector(windowed);
      maybeDeleteVector(spectrum);
      maybeDeleteVector(peaks.frequencies);
      maybeDeleteVector(peaks.magnitudes);
      maybeDeleteVector(hpcp);
      maybeDeleteVector(mfcc);

      if (i % PROGRESS_EVERY_FRAMES === 0) {
        self.postMessage({ type: "progress", frames: i });
      }
    }

    self.postMessage({ type: "result", payload: { mfccs, hpcps, rmsDb } satisfies FrameFeatures });
  } catch (err) {
    const message =
      err instanceof Error ? err.message || err.toString() : String(err);
    self.postMessage({ type: "error", message });
  }
};
