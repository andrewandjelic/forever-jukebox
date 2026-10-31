import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CachedAnalysisTrack,
  deleteCachedAnalysis,
  listCachedAnalysisTracks,
} from "@/core/infrastructure/cache/analysisCache";
import type { LibrarySong } from "@/core/infrastructure/library/musicLibrary";
import { formatDuration } from "@/shared/utils/format";
import { DropZone } from "@/ui/components/DropZone";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { useMusicLibrary } from "../hooks/useMusicLibrary";
import { useAppState } from "../state/AppState";
import { LibrarySection } from "./home/LibrarySection";
import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { setFile } = useAppState();
  const library = useMusicLibrary(location.pathname === "/");
  const [cachedTracks, setCachedTracks] = useState<CachedAnalysisTrack[]>([]);
  const [isLoadingCachedTracks, setIsLoadingCachedTracks] = useState(false);
  const [deletingFingerprint, setDeletingFingerprint] = useState<string | null>(null);
  const [cachedTrackError, setCachedTrackError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // With a music folder connected, a dropped song is added to it (audio and
  // analysis) once analyzed.
  const handleFile = (file: File) => {
    const target = library.folder && library.isGranted
      ? { dir: library.folder, audioName: file.name, copyAudio: true }
      : null;
    setFile(file, target);
    navigate("/listen");
  };

  const handlePlaySong = (song: LibrarySong) => {
    setLibraryError(null);
    song.fileHandle
      .getFile()
      .then((file) => {
        setFile(file, { dir: song.dir, audioName: song.name, copyAudio: false });
        navigate("/listen");
      })
      .catch((err) => {
        console.warn(`Failed to open library song: ${String(err)}`);
        setLibraryError(t("library.openFailed", { name: song.title }));
      });
  };

  const refreshCachedTracks = useCallback(async () => {
    setIsLoadingCachedTracks(true);
    setCachedTrackError(null);
    try {
      const tracks = await listCachedAnalysisTracks();
      setCachedTracks(tracks);
    } catch {
      setCachedTrackError(t("home.loadFailed"));
      setCachedTracks([]);
    } finally {
      setIsLoadingCachedTracks(false);
    }
  }, [t]);

  useEffect(() => {
    if (location.pathname !== "/") {
      return;
    }
    refreshCachedTracks().catch((err) => {
      console.warn(`Failed to refresh cached tracks: ${String(err)}`);
    });
  }, [location.pathname, refreshCachedTracks]);

  const onDeleteCachedTrack = useCallback(async (fingerprint: string) => {
    setDeletingFingerprint(fingerprint);
    setCachedTrackError(null);
    try {
      await deleteCachedAnalysis(fingerprint);
      setCachedTracks((prev) => prev.filter((track) => track.fingerprint !== fingerprint));
    } catch {
      setCachedTrackError(t("home.deleteFailed"));
    } finally {
      setDeletingFingerprint((current) => (current === fingerprint ? null : current));
    }
  }, [t]);

  const handleDeleteCachedTrack = useCallback(
    (fingerprint: string) => {
      onDeleteCachedTrack(fingerprint).catch((err) => {
        console.warn(`Failed to delete cached analysis: ${String(err)}`);
      });
    },
    [onDeleteCachedTrack],
  );

  return (
    <section className="panel home-panel">
      <DropZone onFile={handleFile} />
      {library.supported ? (
        <LibrarySection library={library} onPlay={handlePlaySong} error={libraryError} />
      ) : null}
      <div className="cached-tracks">
        <h2 className="cached-tracks__title">
          <span>{t("home.cachedAnalysis")}</span>
          <span className="cached-tracks__title-hint">
            {t("home.cachedHint")}
          </span>
        </h2>
        {isLoadingCachedTracks ? <p>{t("home.loadingCached")}</p> : null}
        {!isLoadingCachedTracks && cachedTrackError ? (
          <p>{cachedTrackError}</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length === 0 ? (
          <p>{t("home.noCached")}</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length > 0 ? (
          <ul className="cached-tracks__list">
            {cachedTracks.map((track) => {
              const title =
                track.title ??
                t("home.cachedTrack", {
                  id: track.fingerprint.slice(0, 8),
                });
              const label = track.artist
                ? `${title} — ${track.artist}`
                : title;
              const details = track.durationSeconds
                ? formatDuration(Math.round(track.durationSeconds))
                : null;
              const isDeleting = deletingFingerprint === track.fingerprint;

              return (
                <li key={track.fingerprint} className="cached-tracks__item">
                  <div className="cached-tracks__content">
                    <span className="cached-tracks__name" title={label}>
                      {label}
                    </span>
                    {details ? (
                      <span className="cached-tracks__meta">{details}</span>
                    ) : null}
                  </div>
                  <button
                    className="cached-tracks__delete"
                    type="button"
                    onClick={() => handleDeleteCachedTrack(track.fingerprint)}
                    disabled={isDeleting}
                    aria-label={t("home.deleteNamed", { label })}
                    title={t("home.deleteTitle")}
                  >
                    <SymbolIcon className="cached-tracks__delete-icon" name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
