import { useLayoutEffect, useRef } from "react";
import { formatListenMultiplier, formatPlaybackTitle } from "../../format";
import { useMarquee } from "../../hooks/useMarquee";
import { useAppStore } from "../../store";
import { useTranslation } from "react-i18next";

// "4.2× original": listen time as a multiple of the song's length. It changes
// only once per tenth of a play-through, so unlike the counters above it can
// render through React, in its own component so VizInfo doesn't re-render.
// Keying the value on it replays its highlight on every tick.
function ListenMultiplier() {
  const { t, i18n } = useTranslation();
  const tenths = useAppStore((s) => s.listenMultiplierTenths);
  if (tenths === null) {
    return null;
  }
  const value = formatListenMultiplier(tenths, i18n.language);
  return (
    <>
      <span className="viz-divider">·</span>
      <span
        key={tenths}
        id="listen-multiplier"
        className="listen-multiplier"
        title={t("playback.listenMultiplierHint", { value })}
      >
        {t("playback.listenMultiplier", { value })}
      </span>
    </>
  );
}

// Viz-bottom track info: marquee title, listen time and beat counters.
// Rendered into the .viz-info container.
export function VizInfo() {
  const { t } = useTranslation();
  const trackTitle = useAppStore((s) => s.trackTitle);
  const trackArtist = useAppStore((s) => s.trackArtist);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const bringItHomeMode = useAppStore((s) => s.bringItHomeMode);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const listenTimeRef = useRef<HTMLSpanElement | null>(null);
  const beatsPlayedRef = useRef<HTMLSpanElement | null>(null);

  // listenTimeText (~5Hz) and beatsPlayedText (engine-rate) change far too
  // often to drive React renders — each would re-run the title/marquee work
  // several times a second during playback. Write them straight to their DOM
  // nodes through a transient store subscription instead, so VizInfo only
  // re-renders when the track metadata around them actually changes.
  useLayoutEffect(() => {
    const seed = useAppStore.getState();
    if (listenTimeRef.current) {
      listenTimeRef.current.textContent = seed.listenTimeText;
    }
    if (beatsPlayedRef.current) {
      beatsPlayedRef.current.textContent = seed.beatsPlayedText;
    }
    return useAppStore.subscribe((state, prev) => {
      if (
        state.listenTimeText !== prev.listenTimeText &&
        listenTimeRef.current
      ) {
        listenTimeRef.current.textContent = state.listenTimeText;
      }
      if (
        state.beatsPlayedText !== prev.beatsPlayedText &&
        beatsPlayedRef.current
      ) {
        beatsPlayedRef.current.textContent = state.beatsPlayedText;
      }
    });
  }, []);

  const displayTitle =
    trackTitle || trackArtist
      ? (() => {
          const withSuffix = formatPlaybackTitle(
            trackTitle ?? t("common.unknown"),
            audioMode,
          );
          return trackArtist ? `${withSuffix} — ${trackArtist}` : withSuffix;
        })()
      : t("common.appName");
  useMarquee(titleRef, displayTitle);

  const beatsLabel =
    audioMode === "cowbell"
      ? t("playback.totalCowbells")
      : t("playback.totalBeats");

  return (
    <>
      <div className="viz-title" id="viz-now-playing" ref={titleRef}></div>
      <div className="viz-meta">
        <span className="viz-meta-stats">
          <span>{t("playback.listenTime")}</span>
          <span id="listen-time" ref={listenTimeRef}></span>
          <ListenMultiplier />
          <span id="viz-beats-divider" className="viz-divider">
            ·
          </span>
          <span id="viz-beats-label">{beatsLabel}</span>
          <span id="beats-played" ref={beatsPlayedRef}></span>
        </span>
        <span
          id="bring-home-fullscreen-label"
          className={
            bringItHomeMode
              ? "bring-home-fullscreen-note"
              : "bring-home-fullscreen-note is-hidden"
          }
        >
          · {t("playback.bringingHome")}
        </span>
      </div>
    </>
  );
}
