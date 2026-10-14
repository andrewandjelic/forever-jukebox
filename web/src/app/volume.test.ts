import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStoredVolumePct, storeVolumePct } from "./volume";

function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  return store;
}

describe("volume preference", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to full volume when storage is empty", () => {
    expect(resolveStoredVolumePct()).toBe(100);
  });

  it("persists and reads the volume, including mute", () => {
    storeVolumePct(42);
    expect(localStorage.getItem("fj-volume")).toBe("42");
    expect(resolveStoredVolumePct()).toBe(42);
    storeVolumePct(0);
    expect(resolveStoredVolumePct()).toBe(0);
  });

  it("falls back to full volume when storage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeVolumePct(30)).not.toThrow();
    expect(resolveStoredVolumePct()).toBe(100);
  });
});
