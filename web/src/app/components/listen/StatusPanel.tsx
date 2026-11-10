import { useEffect, useState } from "react";
import { fetchJobLog } from "../../api";
import { formatErrorForDisplay } from "../../errorDisplay";
import { getResumeIndex, hasInactiveSavedPlaylist } from "../../playlist";
import { loadPlaylistIndex } from "../../playlist-actions";
import { useAppStore } from "../../store";
import { retryTrack } from "../../track-select";
import { showToast } from "../../ui";
import { useTranslation } from "react-i18next";

// The server's log for a failed load, to read or paste into a bug report.
function FailureDetails({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  // undefined while loading, null when the server recorded none.
  const [log, setLog] = useState<string | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJobLog(jobId).then(
      (text) => !cancelled && setLog(text),
      (err) => !cancelled && setLoadError(formatErrorForDisplay(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log ?? "");
      showToast(t("status.detailsCopied"));
    } catch (err) {
      showToast(t("status.copyFailed", { error: formatErrorForDisplay(err) }), {
        tone: "error",
      });
    }
  };

  if (loadError) {
    return <p className="status-details-note">{t("status.detailsFailed", { error: loadError })}</p>;
  }
  if (log === null) {
    return <p className="status-details-note">{t("status.noDetails")}</p>;
  }
  if (log === undefined) {
    return null;
  }
  return (
    <div className="status-details">
      <pre className="status-details-log">{log}</pre>
      <button type="button" className="status-retry-button" onClick={() => void copy()}>
        {t("status.copyDetails")}
      </button>
    </div>
  );
}

// The Listen-panel status row: spinner, loading progress, analysis status
// text and the saved-playlist shortcut. Hidden once a track is fully
// loaded.
export function StatusPanel() {
  const { t } = useTranslation();
  const statusText = useAppStore((s) => s.analysisStatusText);
  const spinning = useAppStore((s) => s.analysisSpinning);
  const progressText = useAppStore((s) => s.analysisProgressText);
  const retryJobId = useAppStore((s) => s.analysisRetryJobId);
  const failedJobId = useAppStore((s) => s.analysisFailedJobId);
  const [detailsOpenFor, setDetailsOpenFor] = useState<string | null>(null);
  const playlist = useAppStore((s) => s.playlist);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);
  const pendingTitle = useAppStore((s) => s.pendingTrackTitle);

  const audioModePreparing = useAppStore((s) => s.audioModePreparing);

  const panelHidden = audioLoaded && analysisLoaded && !audioModePreparing;
  const noTrackLoaded =
    !audioLoaded &&
    !analysisLoaded &&
    !audioLoadInFlight &&
    !lastTrackId &&
    !lastJobId;
  const showSavedPlaylist = hasInactiveSavedPlaylist(playlist) && noTrackLoaded;
  const resumeIndex = getResumeIndex(playlist);
  const resumeTrack = resumeIndex === null ? null : playlist.tracks[resumeIndex];
  const showContinue = resumeTrack !== null && noTrackLoaded;
  const showDetailsButton = failedJobId !== null && !spinning;
  const detailsOpen = showDetailsButton && detailsOpenFor === failedJobId;

  return (
    <div className={panelHidden ? "panel hidden" : "panel"} id="play-status">
      {pendingTitle && !panelHidden ? (
        <div className="status-title" id="analysis-title">
          {pendingTitle}
        </div>
      ) : null}
      <div className="status-row">
      <div
        className={spinning ? "spinner" : "spinner hidden"}
        id="analysis-spinner"
        aria-hidden="true"
      ></div>
      <div className="status-progress" id="analysis-progress">
        {progressText}
      </div>
      <div className="status-text" id="analysis-status">
        {statusText()}
        {retryJobId && !spinning ? (
          <>
            {" "}
            <button
              type="button"
              className="status-retry-button"
              onClick={() => retryTrack(retryJobId)}
            >
              {t("common.retry")}
            </button>
          </>
        ) : null}
        {showDetailsButton ? (
          <>
            {" "}
            <button
              type="button"
              className="status-retry-button"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpenFor(detailsOpen ? null : failedJobId)}
            >
              {detailsOpen ? t("status.hideDetails") : t("status.details")}
            </button>
          </>
        ) : null}
      </div>
      <button
        id="saved-playlist"
        className={
          showSavedPlaylist
            ? "saved-playlist-button"
            : "saved-playlist-button hidden"
        }
        type="button"
        onClick={() => useAppStore.setState({ playlistModalOpen: true })}
      >
        {t("playlist.saved")}
      </button>
      <button
        id="continue-listening"
        className={
          showContinue
            ? "saved-playlist-button"
            : "saved-playlist-button hidden"
        }
        type="button"
        onClick={() => {
          if (resumeIndex !== null) {
            void loadPlaylistIndex(resumeIndex, { playAfterLoad: true });
          }
        }}
      >
        {t("playlist.continueListening", { title: resumeTrack?.title ?? "" })}
      </button>
      </div>
      {detailsOpen && failedJobId ? <FailureDetails key={failedJobId} jobId={failedJobId} /> : null}
    </div>
  );
}
