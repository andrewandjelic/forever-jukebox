// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VOCAL_MAP_CANCELLED,
  canBuildVocalMaps,
  startVocalMapJob,
} from "@forever-jukebox/shared/audio/vocalMapBuilder";
import { saveVocalMap } from "./api";
import type { AppContext } from "./context";
import { bumpLoadGeneration } from "./playback/load-generation";
import { useAppStore } from "./store";
import {
  cancelVocalMap,
  ensureVocalMap,
  resolveStoredVocalPreference,
  setVocalMapGraphListener,
  storeVocalPreference,
} from "./vocalMapFlow";

vi.mock("@forever-jukebox/shared/audio/vocalMapBuilder", () => ({
  VOCAL_MAP_CANCELLED: "Vocal map cancelled",
  canBuildVocalMaps: vi.fn(() => true),
  startVocalMapJob: vi.fn(),
}));
vi.mock("./api", () => ({ saveVocalMap: vi.fn(async () => true) }));
vi.mock("./ui", () => ({ showToast: vi.fn() }));

const MAP = { version: 1, state: "00", sung: "00", print: "AAAA" };

// A mapping job the test settles by hand.
function pendingJob() {
  let resolve!: (map: typeof MAP) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<typeof MAP>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const cancel = vi.fn(() => reject(new Error(VOCAL_MAP_CANCELLED)));
  vi.mocked(startVocalMapJob).mockReturnValue({ promise, cancel } as never);
  return { resolve, reject, cancel };
}

function createContext(options: { hasMap?: boolean; respectVocals?: boolean } = {}) {
  let hasMap = options.hasMap ?? false;
  const engine = {
    hasVocalMap: vi.fn(() => hasMap),
    setVocalMap: vi.fn(() => {
      hasMap = true;
      return true;
    }),
    getConfig: vi.fn(() => ({ respectVocals: options.respectVocals ?? false })),
  };
  const player = { getSourceBuffer: vi.fn(() => ({}) as AudioBuffer) };
  return { engine, player } as unknown as AppContext & {
    engine: typeof engine;
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("vocal map flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canBuildVocalMaps).mockReturnValue(true);
    cancelVocalMap();
    localStorage.clear();
    useAppStore.setState({
      audioLoaded: true,
      analysisLoaded: true,
      audioModePreparing: false,
      lastJobId: "job-1",
      vizData: {
        beats: [
          { start: 0, duration: 0.5 },
          { start: 0.5, duration: 0.5 },
        ],
      } as never,
    });
  });

  it("remembers whether sung lines are kept whole", () => {
    expect(resolveStoredVocalPreference()).toBe(false);
    storeVocalPreference(true);
    expect(resolveStoredVocalPreference()).toBe(true);
    storeVocalPreference(false);
    expect(resolveStoredVocalPreference()).toBe(false);
  });

  it("maps a song that has no map, applies it and saves it", async () => {
    const job = pendingJob();
    const redraw = vi.fn();
    setVocalMapGraphListener(redraw);
    const context = createContext({ respectVocals: true });

    ensureVocalMap(context);
    expect(useAppStore.getState().vocalMapStatus).toBe("working");
    expect(vi.mocked(startVocalMapJob).mock.calls[0][1]).toEqual([
      { start: 0, duration: 0.5 },
      { start: 0.5, duration: 0.5 },
    ]);
    job.resolve(MAP);
    await settle();

    expect(context.engine.setVocalMap).toHaveBeenCalledWith(MAP);
    expect(useAppStore.getState().vocalMapStatus).toBe("ready");
    expect(redraw).toHaveBeenCalledWith(context);
    expect(saveVocalMap).toHaveBeenCalledWith("job-1", MAP);
  });

  it("leaves the graph alone when the rule is off", async () => {
    const job = pendingJob();
    const redraw = vi.fn();
    setVocalMapGraphListener(redraw);

    ensureVocalMap(createContext({ respectVocals: false }));
    job.resolve(MAP);
    await settle();

    expect(redraw).not.toHaveBeenCalled();
    expect(saveVocalMap).toHaveBeenCalled();
  });

  it("does nothing for a song that already has a map", () => {
    ensureVocalMap(createContext({ hasMap: true }));
    expect(startVocalMapJob).not.toHaveBeenCalled();
    expect(useAppStore.getState().vocalMapStatus).toBe("ready");
  });

  it("waits while this browser cannot map, or another render is running", () => {
    vi.mocked(canBuildVocalMaps).mockReturnValue(false);
    ensureVocalMap(createContext());
    vi.mocked(canBuildVocalMaps).mockReturnValue(true);
    useAppStore.setState({ audioModePreparing: true });
    ensureVocalMap(createContext());
    expect(startVocalMapJob).not.toHaveBeenCalled();
  });

  it("starts one job at a time", () => {
    pendingJob();
    const context = createContext();
    ensureVocalMap(context);
    ensureVocalMap(context);
    expect(startVocalMapJob).toHaveBeenCalledTimes(1);
  });

  it("drops a map that finishes after the song was replaced", async () => {
    const job = pendingJob();
    const context = createContext({ respectVocals: true });
    ensureVocalMap(context);

    bumpLoadGeneration();
    job.resolve(MAP);
    await settle();

    expect(context.engine.setVocalMap).not.toHaveBeenCalled();
    expect(saveVocalMap).not.toHaveBeenCalled();
  });

  it("stops quietly when the song is replaced mid-way", async () => {
    const job = pendingJob();
    ensureVocalMap(createContext());

    cancelVocalMap();
    await settle();

    expect(job.cancel).toHaveBeenCalled();
    expect(useAppStore.getState().vocalMapStatus).toBe("idle");
  });

  it("reports a failure without disturbing the song", async () => {
    const job = pendingJob();
    ensureVocalMap(createContext());

    job.reject(new Error("WebGPU adapter unavailable"));
    await settle();

    expect(useAppStore.getState().vocalMapStatus).toBe("failed");
    expect(saveVocalMap).not.toHaveBeenCalled();
  });
});
