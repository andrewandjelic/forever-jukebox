import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { setMasterVolume } from "./status-ui";

function createContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    player: { setVolume: vi.fn() },
    cowbellOverlay: { setVolume: vi.fn() },
    ...overrides,
  } as unknown as AppContext;
}

describe("setMasterVolume", () => {
  it("fans a percentage out to every sink as a 0–1 fraction", () => {
    const context = createContext();

    setMasterVolume(context, 50);

    // The regression this guards: forgetting /100 ships audio 100x too loud.
    expect(context.player.setVolume).toHaveBeenCalledWith(0.5);
    expect(context.cowbellOverlay.setVolume).toHaveBeenCalledWith(0.5);
  });

  it("passes 0 and 100 through cleanly", () => {
    const context = createContext();

    setMasterVolume(context, 0);
    expect(context.player.setVolume).toHaveBeenLastCalledWith(0);

    setMasterVolume(context, 100);
    expect(context.player.setVolume).toHaveBeenLastCalledWith(1);
  });
});
