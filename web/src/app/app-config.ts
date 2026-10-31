import type { AppConfig } from "./api";
import {
  hydrateFavoritesFromSync,
  updateFavorites,
} from "./favorites-actions";
import { configureMaxFavorites, maxFavorites } from "./favorites";
import { useAppStore } from "./store";

type ApplyAppConfigOptions = {
  hydrateFavorites?: boolean;
};

// Startup: apply the config cached in IndexedDB until the server's answers,
// then apply and cache the fresh one. The cached copy never lands after the
// fresh one: a slow IndexedDB read could otherwise put back a copy saved by an
// older build, without spotify_configured, and send search to Spotify with no
// keys.
export function bootstrapAppConfig(
  loadCached: () => Promise<unknown | null>,
  fetchFresh: () => Promise<AppConfig>,
  saveCached: (config: AppConfig) => Promise<void>,
) {
  let freshApplied = false;
  const cached = loadCached()
    .then((config) => {
      if (config && !freshApplied) {
        applyAppConfig(config as AppConfig, { hydrateFavorites: false });
      }
    })
    .catch((err) => {
      console.warn(`App config load failed: ${String(err)}`);
    });
  const fresh = fetchFresh()
    .then((config) => {
      freshApplied = true;
      applyAppConfig(config);
      return saveCached(config);
    })
    .catch((err) => {
      console.warn(`App config fetch failed: ${String(err)}`);
    });
  return Promise.all([cached, fresh]).then(() => undefined);
}

  // Upload-section visibility/hints and the footer credit render in React
  // from appConfig/footerCredit store state.
export function applyAppConfig(
    config: AppConfig,
    options: ApplyAppConfigOptions = {},
  ) {
    useAppStore.setState({ appConfig: config });
    configureMaxFavorites(config.max_favorites);
    if (useAppStore.getState().favorites.length > maxFavorites()) {
      updateFavorites(useAppStore.getState().favorites, { sync: false });
    }
    useAppStore.getState().setFooterCredit({
      hostedByName: config.hosted_by_name?.trim() || null,
      hostedByUrl: config.hosted_by_url?.trim() || null,
    });
    const allowUpload = Boolean(config.allow_user_upload);
    const allowUrl = Boolean(config.allow_user_url);
    const showUpload = allowUpload || allowUrl;
    if (!showUpload && useAppStore.getState().searchTab === "upload") {
      useAppStore.setState({ searchTab: "search" });
    }
    if (options.hydrateFavorites !== false && config.allow_favorites_sync) {
      void hydrateFavoritesFromSync();
    }
  }
