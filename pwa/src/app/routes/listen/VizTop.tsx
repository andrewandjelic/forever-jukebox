import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { getVisualizationLabel } from "./labels";

export function VizTop({
  activeVizIndex,
  vizCount,
  onActiveVizChange,
}: {
  activeVizIndex: number;
  vizCount: number;
  onActiveVizChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="viz-top">
      <div className="viz-controls">
        <label className="viz-select-group" htmlFor="viz-select">
          <span className="viz-select-wrap">
            <select
              id="viz-select"
              className="viz-select"
              aria-label={t("listen.visualization")}
              value={String(activeVizIndex)}
              onChange={(event) => onActiveVizChange(Number(event.target.value))}
            >
              {Array.from({ length: vizCount }, (_, index) => (
                <option key={index} value={index}>
                  {getVisualizationLabel(index, t)}
                </option>
              ))}
            </select>
            <SymbolIcon className="viz-select-arrow" name="arrow_drop_down" />
          </span>
        </label>
      </div>
    </div>
  );
}
