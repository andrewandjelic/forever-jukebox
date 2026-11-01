import type React from "react";
import { useTranslation } from "react-i18next";
import {
  formatDuration,
  formatListenMultiplier,
  listenMultiplierTenths,
} from "@/shared/utils/format";

export function VizInfo({
  vizTitleRef,
  trackDurationSeconds,
  listenSeconds,
  beatsLabel,
  beatsPlayed,
  bringItHomeMode,
}: {
  vizTitleRef: React.RefCallback<HTMLDivElement>;
  trackDurationSeconds: number;
  listenSeconds: number;
  beatsLabel: string;
  beatsPlayed: number;
  bringItHomeMode: boolean;
}) {
  const { t, i18n } = useTranslation();
  const multiplierTenths = listenMultiplierTenths(
    listenSeconds,
    trackDurationSeconds,
  );
  const multiplier =
    multiplierTenths === null
      ? null
      : formatListenMultiplier(multiplierTenths, i18n.language);
  return (
    <div className="viz-info">
      <div className="viz-title" id="viz-now-playing" ref={vizTitleRef}></div>
      <div className="viz-meta">
        <span className="viz-meta-stats">
          <span>{t("listen.listenTime")}</span>
          <span>{formatDuration(listenSeconds)}</span>
          {multiplier !== null ? (
            <>
              <span className="viz-divider">·</span>
              {/* "4.2× original"; the key replays its highlight on each tick. */}
              <span
                key={multiplierTenths}
                id="listen-multiplier"
                className="listen-multiplier"
                title={t("listen.listenMultiplierHint", { value: multiplier })}
              >
                {t("listen.listenMultiplier", { value: multiplier })}
              </span>
            </>
          ) : null}
          <span className="viz-divider">·</span>
          <span>{beatsLabel}</span>
          <span>{beatsPlayed}</span>
        </span>
        {bringItHomeMode ? (
          <span className="bring-home-fullscreen-note">· Bringing it on home</span>
        ) : null}
      </div>
    </div>
  );
}
