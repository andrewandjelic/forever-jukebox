import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../store";
import { VizBottomRight } from "./VizBottomRight";

const h = vi.hoisted(() => ({
  setAutocanonizerStreamPans: vi.fn(),
  setMasterVolume: vi.fn(),
  toggleFullscreen: vi.fn(),
}));

vi.mock("../../playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback")>()),
  setAutocanonizerStreamPans: h.setAutocanonizerStreamPans,
  setMasterVolume: h.setMasterVolume,
}));
vi.mock("../../fullscreen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../fullscreen")>()),
  toggleFullscreen: h.toggleFullscreen,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({})),
}));

describe("VizBottomRight", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        playlist: { tracks: [], currentIndex: -1 },
        volumePct: 50,
        playMode: "jukebox",
        autocanonizerMainPan: 0,
        autocanonizerOtherPan: 0,
        isFullscreen: false,
        playlistModalOpen: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles the volume panel and applies volume changes", async () => {
    render(<VizBottomRight />);
    const panel = document.getElementById("volume-control-panel")!;
    expect(panel.classList.contains("is-hidden")).toBe(true);
    await userEvent.click(document.getElementById("volume-button")!);
    expect(panel.classList.contains("is-hidden")).toBe(false);
    const slider = document.getElementById("volume") as HTMLInputElement;
    // range inputs: fire a change directly
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(h.setMasterVolume).toHaveBeenCalledWith(expect.anything(), 80);
    expect(document.getElementById("volume-val")?.textContent).toBe("80");
    // click-away closes
    await userEvent.click(document.body);
    expect(panel.classList.contains("is-hidden")).toBe(true);
  });

  it("turns the volume with the mouse wheel over the player", () => {
    render(
      <div id="viz-panel">
        <VizBottomRight />
      </div>,
    );
    const player = document.getElementById("viz-panel")!;
    const panel = document.getElementById("volume-control-panel")!;
    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent("wheel", { cancelable: true, ...init });
      act(() => {
        player.dispatchEvent(event);
      });
      return event;
    };

    const up = wheel({ deltaY: -100 });
    expect(up.defaultPrevented).toBe(true);
    expect(useAppStore.getState().volumePct).toBe(55);
    expect(panel.classList.contains("is-hidden")).toBe(false);
    wheel({ deltaY: 200 });
    expect(useAppStore.getState().volumePct).toBe(45);
    // A trackpad's small deltas add up before a step.
    wheel({ deltaY: -60 });
    expect(useAppStore.getState().volumePct).toBe(45);
    wheel({ deltaY: -60 });
    expect(useAppStore.getState().volumePct).toBe(50);
    // Ctrl+wheel is left to the browser's zoom.
    const zoom = wheel({ deltaY: -100, ctrlKey: true });
    expect(zoom.defaultPrevented).toBe(false);
    expect(useAppStore.getState().volumePct).toBe(50);
    expect(h.setMasterVolume).toHaveBeenLastCalledWith(expect.anything(), 50);
  });

  it("reflects external volume sync from the store", () => {
    render(<VizBottomRight />);
    act(() => {
      useAppStore.setState({ volumePct: 25 });
    });
    expect(
      (document.getElementById("volume") as HTMLInputElement).value,
    ).toBe("25");
  });

  it("persists volume changes and shows the muted icon at zero", async () => {
    render(<VizBottomRight />);
    const icon = document.querySelector("#volume-button .volume-icon");
    expect(icon?.textContent).toBe("volume_up");
    await userEvent.click(document.getElementById("volume-button")!);
    const slider = document.getElementById("volume") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, "0");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(localStorage.getItem("fj-volume")).toBe("0");
    expect(icon?.textContent).toBe("volume_off");
  });

  it("keeps volume as master volume in autocanonizer mode", async () => {
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    render(<VizBottomRight />);
    await userEvent.click(document.getElementById("volume-button")!);

    const slider = document.getElementById("volume") as HTMLInputElement;
    expect(slider).not.toBe(null);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(h.setMasterVolume).toHaveBeenCalledWith(expect.anything(), 80);
    expect(document.getElementById("volume-val")?.textContent).toBe("80");
  });

  it("shows and applies independent stream pans in autocanonizer mode", async () => {
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    render(<VizBottomRight />);

    expect(document.getElementById("autocanonizer-pan-button")).not.toBe(null);
    await userEvent.click(document.getElementById("autocanonizer-pan-button")!);

    const slider = document.getElementById(
      "autocanonizer-main-pan",
    ) as HTMLInputElement;
    expect(slider.value).toBe("0");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, "-40");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(h.setAutocanonizerStreamPans).toHaveBeenCalledWith(
      expect.anything(),
      -40,
      0,
    );
    expect(slider.value).toBe("-40");
    expect(
      (
        document.getElementById(
          "autocanonizer-other-pan",
        ) as HTMLInputElement
      ).value,
    ).toBe("0");
  });

  it("renders the fullscreen state and toggles it", async () => {
    render(<VizBottomRight />);
    const button = document.getElementById("fullscreen")!;
    expect(button.getAttribute("aria-label")).toBe("Fullscreen");
    expect(button.querySelector(".fullscreen-icon")?.textContent).toBe(
      "fullscreen",
    );
    await userEvent.click(button);
    expect(h.toggleFullscreen).toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ isFullscreen: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Exit Fullscreen");
    expect(button.querySelector(".fullscreen-icon")?.textContent).toBe(
      "fullscreen_exit",
    );
  });

  it("shows the playlist button only with tracks and opens the modal", async () => {
    render(<VizBottomRight />);
    const button = document.getElementById("playlist-open")!;
    expect(button.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({
        playlist: {
          tracks: [
            {
              id: "a",
              sourceType: "youtube",
              title: "A",
              artist: "",
              duration: null,
            },
            {
              id: "b",
              sourceType: "youtube",
              title: "B",
              artist: "",
              duration: null,
            },
          ],
          currentIndex: 0,
        },
      });
    });
    expect(button.classList.contains("is-hidden")).toBe(false);
    expect(button.getAttribute("title")).toBe("Playlist (1/2)");
    await userEvent.click(button);
    expect(useAppStore.getState().playlistModalOpen).toBe(true);
  });
});
