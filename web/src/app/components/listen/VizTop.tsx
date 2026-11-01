import { useEffect, useState } from "react";
import { VISUALIZATION_LABELS } from "../../constants";
import { trackEvent } from "../../analytics";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { setActiveVisualization } from "../../playback-ui";
import {
  VIZ_STYLES,
  VIZ_STYLE_LABELS,
  applyStyle,
  getTrackStyle,
  saveTrackStyle,
  type VizStyle,
} from "../../vizStyle";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function getVisualizationLabel(index: number, t: TFunction) {
  return VISUALIZATION_LABELS[index] ??
    t("playback.visualizationNumber", { number: index + 1 });
}

function getVisualizationSelectEntries(count: number, t: TFunction) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    label: getVisualizationLabel(index, t),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

// The viz-top controls: style select, visualization select and the rotate and
// ride toggles. Rendered into the .viz-top container.
export function VizTop() {
  const { t } = useTranslation();
  const activeVizIndex = useAppStore((s) => s.activeVizIndex);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioModePreparing = useAppStore((s) => s.audioModePreparing);
  const trackId = useAppStore((s) => s.lastTrackId ?? s.lastJobId);
  // Genres belong to the loaded analysis; ignore them until it has loaded so
  // a new track never borrows the previous one's genres.
  const trackGenres = useAppStore((s) =>
    s.analysisLoaded ? s.trackGenres : null,
  );
  const trackTitle = useAppStore((s) =>
    s.analysisLoaded ? [s.trackTitle, s.trackArtist].filter(Boolean).join(" - ") : null,
  );
  const [vizStyle, setVizStyle] = useState<VizStyle>(() =>
    getTrackStyle(trackId, trackGenres, trackTitle),
  );
  // Each song remembers its own style, falling back to its title or genre.
  useEffect(() => {
    const style = getTrackStyle(trackId, trackGenres, trackTitle);
    setVizStyle(style);
    applyStyle(style);
  }, [trackId, trackGenres, trackTitle]);

  // Automatic rotation/flow; layouts start static.
  const [rotating, setRotating] = useState(false);
  // Follow cam ("ride"): flies a camera down the line on layouts that offer it.
  const [riding, setRiding] = useState(false);
  const canRide =
    getAppContext().jukebox?.canFollowCam(activeVizIndex) ?? false;

  const vizSelectDisabled =
    !(audioLoaded && analysisLoaded) || audioModePreparing;
  // On the very first render the controllers are not constructed yet (the
  // ref handoff happens at commit); fall back to the static label count.
  const entries = getVisualizationSelectEntries(
    getAppContext().jukebox?.getCount() ?? VISUALIZATION_LABELS.length,
    t,
  );

  return (
    <>
      <div className="viz-actions">
        <label className="viz-select-group" htmlFor="style-select">
          <span className="viz-select-wrap">
            <select
              id="style-select"
              className="viz-select"
              aria-label="Visual style"
              value={vizStyle}
              onChange={(event) => {
                const style = event.target.value as VizStyle;
                setVizStyle(style);
                saveTrackStyle(trackId, style);
                applyStyle(style);
              }}
            >
              {VIZ_STYLES.map((style) => (
                <option key={style} value={style}>
                  {VIZ_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
            <span
              className="material-symbols-outlined viz-select-arrow"
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
          </span>
        </label>
      </div>
      <div className="viz-controls">
        <label className="viz-select-group" htmlFor="viz-select">
          <span className="viz-select-wrap">
            <select
              id="viz-select"
              className="viz-select"
              aria-label={t("playback.visualization")}
              disabled={vizSelectDisabled}
              value={String(activeVizIndex)}
              onChange={(event) => {
                const idx = Number(event.target.value);
                if (Number.isFinite(idx)) {
                  // Report the label, not the index: reordering the label list
                  // would otherwise silently remap historical data.
                  trackEvent("select_viz", {
                    viz: VISUALIZATION_LABELS[idx] ?? String(idx),
                  });
                  setActiveVisualization(idx);
                }
              }}
            >
              {entries.map((entry) => (
                <option key={entry.index} value={String(entry.index)}>
                  {entry.label}
                </option>
              ))}
            </select>
            <span
              className="material-symbols-outlined viz-select-arrow"
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
          </span>
        </label>
        <button
          type="button"
          className={rotating ? "viz-ride-button is-on" : "viz-ride-button"}
          aria-pressed={rotating}
          title="Rotate the visualization"
          onClick={() => {
            const next = !rotating;
            setRotating(next);
            getAppContext().jukebox?.setMotion(next);
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            3d_rotation
          </span>
          Rotate
        </button>
        {canRide && (
          <button
            type="button"
            className={riding ? "viz-ride-button is-on" : "viz-ride-button"}
            aria-pressed={riding}
            title="Ride the line"
            onClick={() => {
              const next = !riding;
              setRiding(next);
              getAppContext().jukebox?.setFollowCam(next);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              videocam
            </span>
            Ride
          </button>
        )}
      </div>
    </>
  );
}
