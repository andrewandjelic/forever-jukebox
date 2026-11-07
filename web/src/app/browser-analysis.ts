import {
  type ClientFailureContext,
  claimClientAnalysis,
  failClientAnalysis,
  fetchAudio,
  reportClientAnalysisProgress,
  submitClientAnalysis,
} from "./api";

// Analyzes queued jobs in this tab with the offline app's in-browser engine,
// when the server allows it (ALLOW_CLIENT_ANALYSIS: a local setup with no
// analysis worker). The result goes back to the server, so the track completes
// and persists like any other. One job at a time; a job keeps going if the
// user moves on to another track.

// Keeps the server-side claim fresh (it lapses after two quiet minutes).
const HEARTBEAT_MS = 30_000;
const PROGRESS_REPORT_MS = 3_000;
// Between claim attempts for one job, e.g. while a worker or tab holds it.
const RETRY_CLAIM_MS = 15_000;

const runningPercent = new Map<string, number>();
const lastAttempt = new Map<string, number>();
let queue: Promise<void> = Promise.resolve();

// Percent done when this tab is analyzing the job, else null.
export function getBrowserAnalysisPercent(jobId: string): number | null {
  return runningPercent.get(jobId) ?? null;
}

// Safe to call on every poll: claims the job when it is free, at most once
// per RETRY_CLAIM_MS.
export function ensureBrowserAnalysis(jobId: string): void {
  const now = Date.now();
  if (runningPercent.has(jobId) || now - (lastAttempt.get(jobId) ?? 0) < RETRY_CLAIM_MS) {
    return;
  }
  lastAttempt.set(jobId, now);
  queue = queue
    .then(() => analyzeJob(jobId))
    .catch((err) => {
      console.warn(`Browser analysis failed: ${String(err)}`);
    });
}

// Mirrors the offline app's overall progress: decode 0-10, beats 10-40,
// features and segments 45-85, building 85-100.
function overallPercent(stage: string, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (stage === "beats") {
    return 10 + Math.min(1, p / 0.4) * 30;
  }
  if (stage === "features" || stage === "segments") {
    return 45 + p * 40;
  }
  if (stage === "building") {
    return 85 + p * 15;
  }
  return 10;
}

// Where an attempt got to, for the server's failure log.
type AttemptState = { stage: string; durationS?: number };

async function analyzeAudio(
  jobId: string,
  report: (percent: number, force?: boolean) => void,
  attempt: AttemptState,
): Promise<unknown> {
  attempt.stage = "loading the engine";
  // Loaded on first use: the engine (ffmpeg.wasm, Essentia, madmom) is large.
  const [{ prepareAnalysisAudioWithFfmpeg }, { AnalysisWorkerClient }] = await Promise.all([
    import("@pwa/core/infrastructure/audio/ffmpegAudio"),
    import("@pwa/core/infrastructure/analysis/AnalysisWorkerClient"),
  ]);
  attempt.stage = "fetching audio";
  const bytes = await fetchAudio(jobId);
  report(2);
  attempt.stage = "decoding";
  const audio = await prepareAnalysisAudioWithFfmpeg(new File([bytes], jobId));
  attempt.durationS = audio.duration;
  report(10, true);
  return new AnalysisWorkerClient().analyze({
    mono22050: audio.mono22050,
    mono44100: audio.mono44100,
    duration: audio.duration,
    trackMeta: { duration: audio.duration },
    onProgress: ({ stage, progress }) => {
      attempt.stage = stage;
      report(overallPercent(stage, progress));
    },
  });
}

function failureContext(
  err: unknown,
  attempt: AttemptState,
  percent: number,
): ClientFailureContext {
  // deviceMemory is Chromium-only, and not in TypeScript's DOM types.
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    stage: attempt.stage,
    percent,
    duration_s: attempt.durationS,
    stack: err instanceof Error ? err.stack : undefined,
    browser: navigator.userAgent,
    cpu_threads: navigator.hardwareConcurrency || undefined,
    device_memory_gb: memory,
  };
}

async function analyzeJob(jobId: string): Promise<void> {
  if (!(await claimClientAnalysis(jobId))) {
    return;
  }
  let percent = 0;
  let lastReport = 0;
  const report = (value: number, force = false) => {
    percent = Math.max(percent, value);
    runningPercent.set(jobId, percent);
    const now = Date.now();
    if (force || now - lastReport >= PROGRESS_REPORT_MS) {
      lastReport = now;
      reportClientAnalysisProgress(jobId, percent).catch(() => undefined);
    }
  };
  report(0, true);
  const heartbeat = window.setInterval(() => report(percent, true), HEARTBEAT_MS);
  const attempt: AttemptState = { stage: "starting" };
  try {
    let analysis: unknown;
    try {
      analysis = await analyzeAudio(jobId, report, attempt).catch(() =>
        // One retry covers transient failures, such as a worker script that
        // failed to load while the dev server restarted.
        analyzeAudio(jobId, report, attempt),
      );
    } catch (err) {
      // Only the analysis itself fails the job; a rejected submit below may
      // mean another tab took the claim over.
      // The name says what kind of failure it was (RangeError: out of memory).
      const message =
        err instanceof Error && err.name && err.name !== "Error"
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      await failClientAnalysis(jobId, message, failureContext(err, attempt, percent)).catch(
        () => undefined,
      );
      throw err;
    }
    await submitClientAnalysis(jobId, analysis);
  } finally {
    window.clearInterval(heartbeat);
    runningPercent.delete(jobId);
  }
}
