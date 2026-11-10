import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../store";
import { KeepSungLinesToggle } from "./KeepSungLinesToggle";

const h = vi.hoisted(() => ({
  setKeepSungLines: vi.fn(),
  buildable: vi.fn(() => true),
  context: { marker: "context" },
}));

vi.mock("../../playback/tuning-forms", () => ({
  setKeepSungLines: h.setKeepSungLines,
}));
vi.mock("../../vocalMapFlow", () => ({
  vocalMapsBuildable: h.buildable,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => h.context),
}));

const toggle = () => screen.getByRole("button", { name: /Whole lines/ });
const info = () =>
  screen.getByRole("button", { name: "About keeping sung lines whole" });

describe("KeepSungLinesToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.buildable.mockReturnValue(true);
    act(() => {
      useAppStore.setState({
        audioLoaded: true,
        analysisLoaded: true,
        keepSungLines: false,
        trackHasVocalMap: true,
        vocalMapStatus: "idle",
        vocalMapPercent: 0,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("turns the option on and off without a menu", async () => {
    render(<KeepSungLinesToggle />);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(toggle());
    expect(h.setKeepSungLines).toHaveBeenLastCalledWith(h.context, true);

    act(() => {
      useAppStore.setState({ keepSungLines: true });
    });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(toggle());
    expect(h.setKeepSungLines).toHaveBeenLastCalledWith(h.context, false);
  });

  it("explains itself, and the i pins the explanation open", async () => {
    render(<KeepSungLinesToggle />);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(toggle().getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toContain("Keep sung lines whole");
    expect(tip.textContent).toContain("where the singing pauses");
    expect(tip.classList.contains("is-open")).toBe(false);

    await userEvent.click(info());
    expect(tip.classList.contains("is-open")).toBe(true);
    expect(info().getAttribute("aria-expanded")).toBe("true");

    await userEvent.keyboard("{Escape}");
    expect(tip.classList.contains("is-open")).toBe(false);

    await userEvent.click(info());
    await userEvent.click(document.body);
    expect(tip.classList.contains("is-open")).toBe(false);
  });

  it("shows how far the mapping has got", () => {
    act(() => {
      useAppStore.setState({
        keepSungLines: true,
        trackHasVocalMap: false,
        vocalMapStatus: "working",
        vocalMapPercent: 42,
      });
    });
    render(<KeepSungLinesToggle />);
    expect(toggle().textContent).toContain("42%");
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain(
      "Finding the vocals in this song: 42%.",
    );
  });

  it("says a new song will be mapped the first time", () => {
    act(() => {
      useAppStore.setState({ trackHasVocalMap: false });
    });
    render(<KeepSungLinesToggle />);
    expect(toggle().hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain(
      "mapped the first time you play it",
    );
  });

  it("is off limits when the song has no map and none can be made", () => {
    h.buildable.mockReturnValue(false);
    act(() => {
      useAppStore.setState({ trackHasVocalMap: false });
    });
    render(<KeepSungLinesToggle />);
    expect(toggle().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain(
      "this browser cannot make one",
    );
  });

  it("waits for a song to be loaded", () => {
    act(() => {
      useAppStore.setState({ analysisLoaded: false });
    });
    render(<KeepSungLinesToggle />);
    expect(toggle().hasAttribute("disabled")).toBe(true);
  });
});
