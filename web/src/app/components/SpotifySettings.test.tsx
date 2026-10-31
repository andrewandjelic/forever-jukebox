import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../i18n";
import type { AppConfig } from "../api";
import { useAppStore } from "../store";
import { SpotifySettings } from "./SpotifySettings";

const api = vi.hoisted(() => ({
  connectSpotify: vi.fn(async () => undefined),
  disconnectSpotify: vi.fn(async () => undefined),
  fetchAppConfig: vi.fn(),
}));
vi.mock("../api", () => api);

const baseConfig: AppConfig = { allow_user_upload: true, allow_user_url: true };

function setConfig(config: Partial<AppConfig>) {
  act(() => {
    useAppStore.setState({ appConfig: { ...baseConfig, ...config } });
  });
}

describe("SpotifySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("is hidden unless the jukebox allows local settings", () => {
    setConfig({ allow_local_settings: false });
    const { container } = render(<SpotifySettings />);
    expect(container.innerHTML).toBe("");
  });

  it("connects with the pasted keys and switches search to Spotify", async () => {
    setConfig({ allow_local_settings: true, spotify_configured: false });
    api.fetchAppConfig.mockResolvedValue({
      ...baseConfig,
      allow_local_settings: true,
      spotify_configured: true,
    });
    render(<SpotifySettings />);

    await userEvent.type(document.getElementById("spotify-client-id")!, " my-id ");
    await userEvent.type(document.getElementById("spotify-client-secret")!, "my-secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect Spotify" }));

    expect(api.connectSpotify).toHaveBeenCalledWith("my-id", "my-secret");
    expect(useAppStore.getState().appConfig?.spotify_configured).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Connected. Search now uses Spotify.");
    expect(screen.getByRole("button", { name: "Disconnect Spotify" })).toBeTruthy();
  });

  it("shows why Spotify refused the keys", async () => {
    setConfig({ allow_local_settings: true, spotify_configured: false });
    api.connectSpotify.mockRejectedValueOnce(
      new Error("Spotify did not accept these keys. Check the Client ID and Client Secret."),
    );
    render(<SpotifySettings />);

    await userEvent.type(document.getElementById("spotify-client-id")!, "wrong");
    await userEvent.type(document.getElementById("spotify-client-secret")!, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Connect Spotify" }));

    expect(screen.getByRole("status").textContent).toContain("did not accept these keys");
    expect(api.fetchAppConfig).not.toHaveBeenCalled();
  });
});
