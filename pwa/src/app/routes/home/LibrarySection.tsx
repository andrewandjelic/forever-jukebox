import { useTranslation } from "react-i18next";
import type { MusicLibrary } from "@/app/hooks/useMusicLibrary";
import type { LibrarySong } from "@/core/infrastructure/library/musicLibrary";

type LibrarySectionProps = {
  library: MusicLibrary;
  onPlay: (song: LibrarySong) => void;
  error: string | null;
};

function runAction(action: () => Promise<void>) {
  action().catch((err) => {
    console.warn(`Music library action failed: ${String(err)}`);
  });
}

export function LibrarySection({ library, onPlay, error }: LibrarySectionProps) {
  const { t } = useTranslation();
  const { folder, isGranted, songs, isLoading, hasError } = library;

  return (
    <div className="cached-tracks library">
      <div className="library__header">
        <h2 className="cached-tracks__title">
          <span>{t("library.title")}</span>
          {folder && isGranted ? (
            <span className="cached-tracks__title-hint">
              {t("library.hint", { folder: folder.name })}
            </span>
          ) : null}
        </h2>
        {folder && isGranted ? (
          <div className="library__actions">
            <button className="tab-btn" type="button" onClick={() => runAction(library.refresh)}>
              {t("library.refresh")}
            </button>
            <button className="tab-btn" type="button" onClick={() => runAction(library.chooseFolder)}>
              {t("library.change")}
            </button>
          </div>
        ) : null}
      </div>
      {!folder ? (
        <div className="library__prompt">
          <p>{t("library.chooseHint")}</p>
          <button className="tab-btn" type="button" onClick={() => runAction(library.chooseFolder)}>
            {t("library.choose")}
          </button>
        </div>
      ) : null}
      {folder && !isGranted ? (
        <div className="library__prompt">
          <p>{t("library.reconnectHint", { folder: folder.name })}</p>
          <button className="tab-btn" type="button" onClick={() => runAction(library.reconnect)}>
            {t("library.reconnect")}
          </button>
        </div>
      ) : null}
      {isGranted && isLoading && songs.length === 0 ? <p>{t("library.loading")}</p> : null}
      {isGranted && !isLoading && hasError ? <p>{t("library.loadFailed")}</p> : null}
      {isGranted && !isLoading && !hasError && songs.length === 0 ? (
        <p>{t("library.empty")}</p>
      ) : null}
      {isGranted && songs.length > 0 ? (
        <ul className="cached-tracks__list library__list">
          {songs.map((song) => (
            <li key={`${song.folderPath}/${song.name}`}>
              <button
                className="cached-tracks__item library__song"
                type="button"
                onClick={() => onPlay(song)}
                aria-label={t("library.playNamed", { label: song.title })}
              >
                <span className="cached-tracks__content">
                  <span className="cached-tracks__name" title={song.title}>
                    {song.title}
                  </span>
                  <span className="cached-tracks__meta">
                    <span className={song.analyzed ? "library__analyzed" : undefined}>
                      {song.analyzed ? t("library.analyzed") : t("library.notAnalyzed")}
                    </span>
                    {song.folderPath ? ` · ${song.folderPath}` : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p>{error}</p> : null}
    </div>
  );
}
