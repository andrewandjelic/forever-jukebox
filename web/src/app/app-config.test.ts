import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateFavoritesFromSync,
  updateFavorites,
} from "./favorites-actions";
import { configureMaxFavorites, maxFavorites } from "./favorites";
import { useAppStore } from "./store";
import type { AppConfig } from "./api";
import { applyAppConfig, bootstrapAppConfig } from "./app-config";

vi.mock("./favorites-actions", () => ({
  hydrateFavoritesFromSync: vi.fn(),
  updateFavorites: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

describe("applyAppConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({ footerCredit: null });
  });

  it("applies configured max favorites and trims local state", () => {
    useAppStore.setState({
      favorites: [
      {
        uniqueSongId: "1",
        title: "A",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "2",
        title: "B",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "3",
        title: "C",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
    ]
    });

    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      max_favorites: 2,
    });

    expect(maxFavorites()).toBe(2);
    expect(updateFavorites).toHaveBeenCalledWith(
      useAppStore.getState().favorites,
      { sync: false },
    );
  });

  it("publishes host credit with URL to the shell store", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
      hosted_by_url: "https://example.com",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: "https://example.com",
    });
  });

  it("publishes host credit without URL to the shell store", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: null,
    });
  });

  it("hydrates favorites when fresh config allows sync", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      allow_favorites_sync: true,
    });

    expect(hydrateFavoritesFromSync).toHaveBeenCalledOnce();
  });

  it("skips favorites hydration when applying cached config", () => {
    applyAppConfig(
      {
        allow_user_upload: false,
        allow_user_url: false,
        allow_favorites_sync: true,
      },
      { hydrateFavorites: false },
    );

    expect(hydrateFavoritesFromSync).not.toHaveBeenCalled();
  });
});

describe("bootstrapAppConfig", () => {
  const cachedConfig = { max_favorites: 150 } as AppConfig;
  const freshConfig = {
    max_favorites: 150,
    spotify_configured: false,
  } as AppConfig;

  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  it("keeps the fresh config when the cached read finishes last", async () => {
    const cached = deferred<unknown>();
    const save = vi.fn(async () => {});
    const done = bootstrapAppConfig(
      () => cached.promise,
      async () => freshConfig,
      save,
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(freshConfig));
    cached.resolve(cachedConfig);
    await done;

    expect(useAppStore.getState().appConfig).toBe(freshConfig);
  });

  it("uses the cached config until the fresh one arrives", async () => {
    const fresh = deferred<AppConfig>();
    const done = bootstrapAppConfig(
      async () => cachedConfig,
      () => fresh.promise,
      async () => {},
    );
    await vi.waitFor(() =>
      expect(useAppStore.getState().appConfig).toBe(cachedConfig),
    );
    fresh.resolve(freshConfig);
    await done;

    expect(useAppStore.getState().appConfig).toBe(freshConfig);
  });

  it("keeps the cached config when the server is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await bootstrapAppConfig(
      async () => cachedConfig,
      async () => {
        throw new Error("offline");
      },
      async () => {},
    );

    expect(useAppStore.getState().appConfig).toBe(cachedConfig);
    warn.mockRestore();
  });
});
