import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setKeepSungLines } from "../../playback/tuning-forms";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { vocalMapsBuildable } from "../../vocalMapFlow";

// "Keep sung lines whole" as a toggle on the visualizer's top bar, so it does
// not take a trip through Tune. Resting the pointer on the button for a
// moment explains it; the small "i" beside it explains it at once, and by
// tap or keyboard too.
export function KeepSungLinesToggle() {
  const { t } = useTranslation();
  const tipId = useId();
  const enabled = useAppStore((s) => s.keepSungLines);
  const loaded = useAppStore((s) => s.audioLoaded && s.analysisLoaded);
  const hasMap = useAppStore((s) => s.trackHasVocalMap);
  const status = useAppStore((s) => s.vocalMapStatus);
  const percent = useAppStore((s) => s.vocalMapPercent);
  const [tipOpen, setTipOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // The "i" pins the explanation open; a click anywhere else or Escape
  // lets it go.
  useEffect(() => {
    if (!tipOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setTipOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTipOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tipOpen]);

  const available = hasMap || vocalMapsBuildable();
  const working = enabled && status === "working";
  let detail = t("vocals.tipFirstTime");
  if (!available) {
    detail = t("tuning.respectVocalsUnavailable");
  } else if (working) {
    detail = t("vocals.tipWorking", { percent });
  } else if (hasMap) {
    detail = t("vocals.tipRemembered");
  }

  return (
    <span className="viz-vocals" ref={wrapRef}>
      <button
        type="button"
        id="keep-sung-lines"
        className={enabled ? "viz-ride-button is-on" : "viz-ride-button"}
        aria-pressed={enabled}
        aria-describedby={tipId}
        disabled={!loaded || !available}
        onClick={() => setKeepSungLines(getAppContext(), !enabled)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          lyrics
        </span>
        {working
          ? t("vocals.buttonWorking", { percent })
          : t("vocals.button")}
      </button>
      <button
        type="button"
        className="viz-vocals-info"
        aria-label={t("vocals.about")}
        aria-expanded={tipOpen}
        aria-controls={tipId}
        onClick={() => setTipOpen((open) => !open)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          info
        </span>
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={tipOpen ? "viz-tip is-open" : "viz-tip"}
      >
        <strong>{t("tuning.respectVocals")}</strong>
        <span>{t("vocals.tip")}</span>
        <span className="viz-tip-detail">{detail}</span>
      </span>
    </span>
  );
}
