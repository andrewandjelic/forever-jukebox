import { useEffect, useRef, useState } from "react";
import { setMasterVolume } from "../../playback";
import {
  hasActivePlaylistControls,
  hasPlaylistControls,
} from "../../playlist";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { toggleFullscreen } from "../../fullscreen";
import { storeVolumePct } from "../../volume";
import { useTranslation } from "react-i18next";

// Wheel distance per 5% volume step: one mouse-wheel notch (about 100px in
// Chrome), or a short trackpad swipe.
const WHEEL_PX_PER_STEP = 100;
const WHEEL_STEP_PCT = 5;
const WHEEL_LINE_PX = 33;
// How long the volume panel stays up after the last wheel step.
const WHEEL_PANEL_MS = 1200;

function applyVolume(pct: number) {
  useAppStore.setState({ volumePct: pct });
  setMasterVolume(getAppContext(), pct);
  storeVolumePct(pct);
}

// The right-hand cluster of the viz bottom bar: playlist-open button,
// volume panel, fullscreen toggle. Rendered into the .viz-bottom-right
// container.
export function VizBottomRight() {
  const { t } = useTranslation();
  const playlist = useAppStore((s) => s.playlist);
  const volumePct = useAppStore((s) => s.volumePct);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeWrapRef = useRef<HTMLDivElement | null>(null);

  // Click-away closes the volume panel.
  useEffect(() => {
    if (!volumeOpen) {
      return;
    }
    const onDocumentClick = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && volumeWrapRef.current?.contains(target)) {
        return;
      }
      setVolumeOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [volumeOpen]);

  // Scrolling over the player turns the volume up or down, showing the
  // volume panel while it changes. Ctrl+wheel stays the browser's zoom.
  useEffect(() => {
    const player = volumeWrapRef.current?.closest("#viz-panel");
    if (!player) {
      return;
    }
    let pending = 0;
    let hideTimer: number | undefined;
    const onWheel = (event: Event) => {
      const wheel = event as WheelEvent;
      if (wheel.ctrlKey || wheel.deltaY === 0) {
        return;
      }
      wheel.preventDefault();
      pending -= wheel.deltaMode === 1 ? wheel.deltaY * WHEEL_LINE_PX : wheel.deltaY;
      const steps = Math.trunc(pending / WHEEL_PX_PER_STEP);
      if (steps !== 0) {
        pending -= steps * WHEEL_PX_PER_STEP;
        const current = useAppStore.getState().volumePct;
        const next = Math.max(0, Math.min(100, current + steps * WHEEL_STEP_PCT));
        if (next !== current) {
          applyVolume(next);
        }
      }
      setVolumeOpen(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setVolumeOpen(false), WHEEL_PANEL_MS);
    };
    player.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      player.removeEventListener("wheel", onWheel);
      window.clearTimeout(hideTimer);
    };
  }, []);

  const hasTracks = hasPlaylistControls(playlist);
  const active = hasActivePlaylistControls(playlist);
  const playlistTitle = active
    ? t("playlist.savedWithPosition", {
        current: playlist.currentIndex + 1,
        total: playlist.tracks.length,
      })
    : t("playlist.saved");
  const fullscreenLabel = isFullscreen
    ? t("playback.exitFullscreen")
    : t("playback.fullscreen");

  return (
    <>
      <button
        id="playlist-open"
        className={
          hasTracks
            ? "playlist-control playlist-open-control"
            : "playlist-control playlist-open-control is-hidden"
        }
        type="button"
        aria-label={playlistTitle}
        title={playlistTitle}
        onClick={() => useAppStore.setState({ playlistModalOpen: true })}
      >
        <span
          className="material-symbols-outlined playlist-control-icon"
          aria-hidden="true"
        >
          queue_music
        </span>
      </button>
      <div className="volume-control-wrap" ref={volumeWrapRef}>
        <div
          className={
            volumeOpen ? "volume-control-panel" : "volume-control-panel is-hidden"
          }
          id="volume-control-panel"
        >
          <label>
            <input
              className="volume-slider"
              id="volume"
              type="range"
              aria-label={t("playback.volume")}
              min={0}
              max={100}
              step={1}
              value={volumePct}
              onChange={(event) => applyVolume(Number(event.target.value))}
            />
            <div className="label-line">
              <span id="volume-val">{volumePct}</span>
            </div>
          </label>
        </div>
        <button
          type="button"
          id="volume-button"
          className="volume-button"
          aria-label={t("playback.volume")}
          title={t("playback.volume")}
          onClick={() => setVolumeOpen((prev) => !prev)}
        >
          <span
            className="material-symbols-outlined volume-icon"
            aria-hidden="true"
          >
            {volumePct === 0 ? "volume_off" : "volume_up"}
          </span>
        </button>
      </div>
      <button
        type="button"
        id="fullscreen"
        className="fullscreen-toggle"
        aria-label={fullscreenLabel}
        title={fullscreenLabel}
        onClick={() => toggleFullscreen()}
      >
        <span
          className="material-symbols-outlined fullscreen-icon"
          aria-hidden="true"
        >
          {isFullscreen ? "fullscreen_exit" : "fullscreen"}
        </span>
      </button>
    </>
  );
}
