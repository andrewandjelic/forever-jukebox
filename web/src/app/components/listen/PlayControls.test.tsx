import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../store";
import { PlayControls } from "./PlayControls";
import { VizTop } from "./VizTop";

const h = vi.hoisted(() => ({
  togglePlayback: vi.fn(),
  playlistPrevious: vi.fn(),
  playlistNext: vi.fn(),
  setActiveVisualization: vi.fn(),
  jukebox: {
    getCount: vi.fn(() => 7),
    canFollowCam: vi.fn(() => false),
    setFollowCam: vi.fn(),
    setMotion: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("../../playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback")>()),
  togglePlayback: h.togglePlayback,
}));
vi.mock("../../playlist-actions", () => ({
  playlistPrevious: h.playlistPrevious,
  playlistNext: h.playlistNext,
}));
vi.mock("../../playback-ui", () => ({
  setActiveVisualization: h.setActiveVisualization,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({ jukebox: h.jukebox })),
}));

const tracks = [
  { id: "a", sourceType: "youtube" as const, title: "A", artist: "", duration: null },
  { id: "b", sourceType: "youtube" as const, title: "B", artist: "", duration: null },
];

describe("PlayControls", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        isRunning: false,
        isPaused: false,
        jukeboxAudioMode: "off",
        audioModePreparing: false,
        audioLoaded: true,
        analysisLoaded: true,
        audioLoadInFlight: false,
        analysisPollInFlight: false,
        playlistLoadBusy: false,
        playlist: { tracks: [], currentIndex: -1 },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders play/pause/resume labels from playback state", () => {
    render(<PlayControls />);
    const button = document.getElementById("viz-play")!;
    expect(button.getAttribute("aria-label")).toBe("Play");
    expect(button.querySelector(".play-icon")?.textContent).toBe("play_arrow");
    act(() => {
      useAppStore.setState({ isRunning: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Pause");
    expect(button.querySelector(".play-icon")?.textContent).toBe("pause");
    act(() => {
      useAppStore.setState({ isRunning: false, isPaused: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Resume");
  });

  it("blocks and hides while swing is preparing", () => {
    render(<PlayControls />);
    const button = document.getElementById("viz-play") as HTMLButtonElement;
    act(() => {
      useAppStore.setState({ jukeboxAudioMode: "swing", audioModePreparing: true });
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Preparing Swing mode");
    expect(button.classList.contains("hidden")).toBe(true);
  });

  it("blocks and hides while instrumental is preparing", () => {
    render(<PlayControls />);
    const button = document.getElementById("viz-play") as HTMLButtonElement;
    act(() => {
      useAppStore.setState({
        jukeboxAudioMode: "instrumental",
        audioModePreparing: true,
      });
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(
      "Preparing Instrumental mode",
    );
    expect(button.classList.contains("hidden")).toBe(true);
  });

  it("toggles playback on click", async () => {
    render(<PlayControls />);
    await userEvent.click(document.getElementById("viz-play")!);
    expect(h.togglePlayback).toHaveBeenCalled();
  });

  it("shows playlist prev/next for active playlists and disables while busy", async () => {
    render(<PlayControls />);
    const prev = document.getElementById("playlist-previous") as HTMLButtonElement;
    const next = document.getElementById("playlist-next") as HTMLButtonElement;
    expect(prev.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ playlist: { tracks, currentIndex: 0 } });
    });
    expect(prev.classList.contains("is-hidden")).toBe(false);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    await userEvent.click(next);
    expect(h.playlistNext).toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ playlistLoadBusy: true });
    });
    expect(next.disabled).toBe(true);
  });
});

describe("VizTop", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        activeVizIndex: 1,
        audioLoaded: true,
        analysisLoaded: true,
        audioModePreparing: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sorted visualization options with the active value", () => {
    render(<VizTop />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Arc",
      "Classic",
      "Galaxy",
      "Grid",
      "Hourglass",
      "Infinite",
      "Wave",
    ]);
    expect(select.value).toBe("1");
    expect(select.disabled).toBe(false);
  });

  it("disables the viz select until the track is ready and forwards changes", async () => {
    render(<VizTop />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;
    await userEvent.selectOptions(select, "4");
    expect(h.setActiveVisualization).toHaveBeenCalledWith(4);
    act(() => {
      useAppStore.setState({ audioModePreparing: true });
    });
    expect(select.disabled).toBe(true);
  });

  it("has no play-mode select or mode checkboxes", () => {
    render(<VizTop />);
    expect(document.getElementById("play-mode-select")).toBeNull();
    expect(document.getElementById("canonizer-finish")).toBeNull();
    expect(document.getElementById("wubmachine-loop")).toBeNull();
  });
});
