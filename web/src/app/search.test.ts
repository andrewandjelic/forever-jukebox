import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { SearchDeps } from "./search";
import type { AppConfig } from "./api";
import {
  runSearch,
  selectSpotifyMatch,
  showYoutubeMatches,
  startYoutubeAnalysisFlow,
  tryLoadExistingTrackByName,
} from "./search";
import { DEFAULT_SEARCH_RESULTS, useAppStore } from "./store";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./api", () => ({
  fetchJobByTrack: vi.fn(),
  searchSpotify: vi.fn(),
  searchYoutube: vi.fn(),
  startYoutubeAnalysis: vi.fn(),
}));

vi.mock("./playback", () => {
  let generation = 0;
  return {
    tryLoadCachedAudio: vi.fn(),
    bumpLoadGeneration: vi.fn(() => {
      generation += 1;
      return generation;
    }),
    getLoadGeneration: vi.fn(() => generation),
    isStaleLoad: vi.fn((g: number) => g !== generation),
  };
});

let api: typeof import("./api");
let playback: typeof import("./playback");

function createContext(): AppContext {
  return {
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    wubmachine: {} as unknown as AppContext["wubmachine"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    cowbellOverlay: {} as unknown as AppContext["cowbellOverlay"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
  };
}

function createDeps(): SearchDeps {
  return {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    showToast: vi.fn(),
    setLoadingProgress: vi.fn(),
    pollAnalysis: vi.fn(),
    applyAnalysisResult: vi.fn(() => true),
    loadAudioFromJob: vi.fn(() => Promise.resolve(true)),
    resetForNewTrack: vi.fn(),
    updateVizVisibility: vi.fn(),
    onTrackChange: vi.fn(),
  };
}




// Status setters receive LocalizedText thunks; evaluate them so assertions
// can compare the resulting strings.
function localizedCalls(mock: unknown): unknown[][] {
  return (mock as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    call.map((arg) =>
      typeof arg === "function" ? (arg as () => unknown)() : arg,
    ),
  );
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
});

describe("search flows", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    vi.clearAllMocks();
    useAppStore.setState({
      searchQuery: "",
      searchResults: DEFAULT_SEARCH_RESULTS,
      searchHint: () => "Step 1: Find a Spotify track.",
    });
    api = await import("./api");
    playback = await import("./playback");
    (playback.tryLoadCachedAudio as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("loads existing track and applies analysis", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      id: "job1",
      source_id: "yt1",
      result: {},
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(true);
    expect(useAppStore.getState().lastTrackId).toBe("job1");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("job1");
    expect(deps.applyAnalysisResult).toHaveBeenCalled();
  });

  it("does not carry current tuning into a newly selected existing track", async () => {
    const context = createContext();
    const deps = createDeps();
    deps.onNormalTrackSelected = vi.fn();
    useAppStore.setState({ tuningParams: "jb=1&thresh=30" });
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      id: "job-with-analysis",
      source_id: "yt-existing",
      result: {},
    });

    await tryLoadExistingTrackByName(context, deps, "Song", "Artist");

    expect(deps.onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job-with-analysis",
        tuningParams: null,
      }),
    );
  });

  it("returns false for missing existing analysis so caller can continue to YouTube matching", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );

    expect(result).toBe(false);
    const results = useAppStore.getState().searchResults;
    expect(results.kind).toBe("message");
    expect(results.kind === "message" && results.text()).toBe(
      "Checking existing analysis...",
    );
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
    expect(deps.pollAnalysis).not.toHaveBeenCalled();
  });

  it("polls instead of applying stale state when existing lookup is still processing", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "processing",
      id: "job-processing",
      source_id: "yt-processing",
      source_provider: "youtube",
      progress: 40,
      message: "Working",
    });

    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );

    expect(result).toBe(true);
    expect(localizedCalls(deps.setLoadingProgress)).toContainEqual([
      null,
      "Fetching audio",
    ]);
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job-processing");
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
  });

  it("treats failed existing lookup as a terminal cached result", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      id: "job-f",
      source_id: "yt-f",
      error: "ERROR: [download] This video is not available.",
      error_code: "download_unavailable",
      source_provider: "youtube",
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(true);
    expect(localizedCalls(deps.setAnalysisStatus)).toContainEqual([
      "YouTube fetch failed.",
      false,
    ]);
    expect(useAppStore.getState().analysisRetryJobId).toBe("job-f");
    expect(deps.pollAnalysis).not.toHaveBeenCalled();
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
  });

  it("offers no retry link for a YouTube bot-check block", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      id: "job-b",
      source_id: "yt-b",
      error: "ERROR: Unable to reach YouTube",
      error_code: "youtube_unreachable",
      source_provider: "youtube",
    });
    await tryLoadExistingTrackByName(context, deps, "Song", "Artist");
    expect(localizedCalls(deps.setAnalysisStatus)).toContainEqual([
      "YouTube is temporarily blocking this server. Please try again later.",
      false,
    ]);
    expect(useAppStore.getState().analysisRetryJobId).toBeNull();
  });

  it("starts youtube analysis flow", async () => {
    const context = createContext();
    useAppStore.setState({ tuningParams: "jb=1" });
    const deps = createDeps();
    deps.onNormalTrackSelected = vi.fn();
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "job2", status: "queued" });
    await startYoutubeAnalysisFlow(context, deps, "yt2", "Song", "Artist");
    expect(deps.onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job2", tuningParams: null }),
    );
    expect(api.startYoutubeAnalysis).toHaveBeenCalledWith({
      youtube_id: "yt2",
      title: "Song",
      artist: "Artist",
    });
    expect(useAppStore.getState().lastTrackId).toBe("job2");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("job2");
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job2");
  });

  it("polls the same job id when YouTube selection restarts an existing job", async () => {
    const context = createContext();
    const deps = createDeps();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: jobId,
      status: "downloading",
      source_id: "yt-retry",
      source_provider: "youtube",
    });

    await startYoutubeAnalysisFlow(
      context,
      deps,
      "yt-retry",
      "Song",
      "Artist",
    );

    expect(useAppStore.getState().lastJobId).toBe(jobId);
    expect(deps.updateTrackUrl).toHaveBeenCalledWith(jobId);
    expect(deps.pollAnalysis).toHaveBeenCalledWith(jobId);
  });

  it("publishes youtube matches to the search results store", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.searchYoutube as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "yt-match", title: "Match", duration: 123 },
    ]);

    await showYoutubeMatches(context, deps, "Song", "Artist", 123);

    expect(deps.navigateToTab).toHaveBeenCalledWith("search", { replace: true });
    expect(useAppStore.getState().searchResults).toEqual({
      kind: "youtube",
      items: [
        {
          item: { id: "yt-match", title: "Match", duration: 123 },
          name: "Song",
          artist: "Artist",
        },
      ],
    });
  });

  it("auto-picks the top match, starts it, and keeps the list as the override", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.searchYoutube as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "yt-plain", title: "Official Audio", duration: 123 },
      { id: "yt-video", title: "Official Video", duration: 123 },
    ]);
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-auto",
      status: "queued",
    });

    await showYoutubeMatches(context, deps, "Song", "Artist", 123, true);
    // the flow runs fire-and-forget; one macrotask tick drains its awaits
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.startYoutubeAnalysis).toHaveBeenCalledWith({
      youtube_id: "yt-plain",
      title: "Song",
      artist: "Artist",
    });
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job-auto");
    const results = useAppStore.getState().searchResults;
    expect(results.kind).toBe("youtube");
    if (results.kind === "youtube") {
      expect(results.autoPickedId).toBe("yt-plain");
      expect(results.items).toHaveLength(2);
    }
  });

  it("does not auto-pick when no candidate has an id", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.searchYoutube as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "No id", duration: 123 },
    ]);

    await showYoutubeMatches(context, deps, "Song", "Artist", 123, true);

    expect(api.startYoutubeAnalysis).not.toHaveBeenCalled();
    const results = useAppStore.getState().searchResults;
    expect(results.kind).toBe("youtube");
    if (results.kind === "youtube") {
      expect(results.autoPickedId).toBeUndefined();
    }
  });

  it("spotify selection auto-starts the top-ranked match when no analysis exists", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.searchYoutube as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "yt-plain", title: "Topic Upload", duration: 200 },
    ]);
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-flow",
      status: "queued",
    });

    await selectSpotifyMatch(context, deps, {
      name: "Song",
      artist: "Artist",
      duration: 200,
    });
    // selectSpotifyMatch chains fire-and-forget promises internally
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.startYoutubeAnalysis).toHaveBeenCalledWith({
      youtube_id: "yt-plain",
      title: "Song",
      artist: "Artist",
    });
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job-flow");
  });
});

describe("search source", () => {
  const youtubeItem = {
    id: "yt-1",
    title: "Tame Impala - Let It Happen (Official Audio)",
    duration: 467,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api = await import("./api");
    vi.mocked(api.searchYoutube).mockResolvedValue([youtubeItem]);
    vi.mocked(api.searchSpotify).mockResolvedValue([]);
  });

  const search = (config: Partial<AppConfig>) => {
    useAppStore.setState({
      appConfig: { allow_user_upload: true, allow_user_url: true, ...config },
      searchQuery: "let it happen",
    });
    return runSearch(createContext(), createDeps());
  };

  it("searches YouTube directly when Spotify is not connected", async () => {
    await search({ spotify_configured: false });

    expect(api.searchYoutube).toHaveBeenCalledWith("let it happen", null);
    expect(api.searchSpotify).not.toHaveBeenCalled();
    expect(useAppStore.getState().searchResults).toEqual({
      kind: "youtube",
      items: [{ item: youtubeItem, name: youtubeItem.title, artist: "" }],
    });
    expect(useAppStore.getState().searchHint()).toContain("Search YouTube");
  });

  it("searches Spotify first once it is connected", async () => {
    await search({ spotify_configured: true });

    expect(api.searchSpotify).toHaveBeenCalledWith("let it happen");
    expect(api.searchYoutube).not.toHaveBeenCalled();
  });

  it("falls back to YouTube when the Spotify search fails", async () => {
    vi.mocked(api.searchSpotify).mockRejectedValue(
      new Error("Spotify credentials missing"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A config without spotify_configured (cached by an older build) still
    // tries Spotify first.
    await search({});

    expect(api.searchSpotify).toHaveBeenCalledWith("let it happen");
    expect(api.searchYoutube).toHaveBeenCalledWith("let it happen", null);
    expect(useAppStore.getState().searchResults).toEqual({
      kind: "youtube",
      items: [{ item: youtubeItem, name: youtubeItem.title, artist: "" }],
    });
    warn.mockRestore();
  });
});
