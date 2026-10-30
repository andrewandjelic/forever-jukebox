import { useState } from "react";
import { useTranslation } from "react-i18next";
import { connectSpotify, disconnectSpotify, fetchAppConfig } from "../api";
import { formatErrorForDisplay } from "../errorDisplay";
import { useAppStore } from "../store";

const SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

// Settings > Spotify search, on a local jukebox only: paste the keys of a
// free Spotify developer app so Search finds songs on Spotify first (then the
// best YouTube match). Without them, Search uses YouTube directly.
export function SpotifySettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!appConfig?.allow_local_settings) {
    return null;
  }
  const connected = Boolean(appConfig.spotify_configured);

  const run = async (action: () => Promise<void>, doneMessage: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      // Search reads spotify_configured from the config to pick its source.
      useAppStore.setState({ appConfig: await fetchAppConfig() });
      setClientId("");
      setClientSecret("");
      setMessage(doneMessage);
    } catch (err) {
      setMessage(formatErrorForDisplay(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" id="settings-spotify">
      <div className="label-line">{t("settings.spotify.title")}</div>
      {connected ? (
        <>
          <p className="hint">{t("settings.spotify.connected")}</p>
          <button
            type="button"
            className="settings-timer-set"
            disabled={busy}
            onClick={() =>
              void run(disconnectSpotify, t("settings.spotify.disconnectedMessage"))
            }
          >
            {t("settings.spotify.disconnect")}
          </button>
        </>
      ) : (
        <>
          <p className="hint">{t("settings.spotify.intro")}</p>
          <ol className="settings-steps">
            <li>
              {t("settings.spotify.step1")}{" "}
              <a href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noreferrer">
                developer.spotify.com/dashboard
              </a>
            </li>
            <li>{t("settings.spotify.step2")}</li>
            <li>{t("settings.spotify.step3")}</li>
          </ol>
          <label className="settings-field" htmlFor="spotify-client-id">
            <span className="label-line">{t("settings.spotify.clientId")}</span>
            <input
              id="spotify-client-id"
              className="search-input"
              aria-label={t("settings.spotify.clientId")}
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </label>
          <label className="settings-field" htmlFor="spotify-client-secret">
            <span className="label-line">{t("settings.spotify.clientSecret")}</span>
            <input
              id="spotify-client-secret"
              className="search-input"
              aria-label={t("settings.spotify.clientSecret")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="settings-timer-set"
            disabled={busy || !clientId.trim() || !clientSecret.trim()}
            onClick={() =>
              void run(
                () => connectSpotify(clientId.trim(), clientSecret.trim()),
                t("settings.spotify.connectedMessage"),
              )
            }
          >
            {busy ? t("settings.spotify.checking") : t("settings.spotify.connect")}
          </button>
        </>
      )}
      {message ? (
        <p className="hint" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
