import { useCallback, useEffect, useRef } from "react";
import { attachViz, getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { ModifierBadges } from "../ModifierBadges";
import { BranchStatsPopup } from "./BranchStatsPopup";
import { PlayControls } from "./PlayControls";
import { VizBottomRight } from "./VizBottomRight";
import { VizInfo } from "./VizInfo";
import { VizTop } from "./VizTop";

// Hosts the viz canvas. The #viz-layer div is a bare, stable JSX node —
// React renders it once and NEVER remounts it (no key, no conditional
// unmount; visibility is class-only), because the controller holds canvas
// state inside. The panel-level ref callback hands the nodes to init's
// attachViz, which constructs the controller exactly once (StrictMode
// re-attaches are ignored there).
export function VizContainer() {
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioModePreparing = useAppStore((s) => s.audioModePreparing);
  const vizStatsPulseId = useAppStore((s) => s.vizStatsPulseId);
  const vizPanelRef = useRef<HTMLDivElement | null>(null);
  const vizLayerRef = useRef<HTMLDivElement | null>(null);

  const visible = audioLoaded && analysisLoaded && !audioModePreparing;

  // Child refs attach before this parent ref, so the layer node is ready.
  const handlePanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      vizPanelRef.current = node;
      if (node && vizLayerRef.current) {
        attachViz({ vizPanel: node, vizLayer: vizLayerRef.current });
      }
    },
    [],
  );

  // Observe the panel and resize the controller, with a window-resize
  // fallback for older browsers without ResizeObserver.
  useEffect(() => {
    const panel = vizPanelRef.current;
    if (!panel) {
      return;
    }
    const handleResize = () => {
      getAppContext().jukebox?.resizeNow();
    };
    if (
      typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !==
      "undefined"
    ) {
      const observer = new ResizeObserver(() => {
        handleResize();
      });
      observer.observe(panel);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Resize the active visualization when the viz becomes visible.
  useEffect(() => {
    if (!visible) {
      return;
    }
    getAppContext().jukebox?.resizeActive();
  }, [visible]);

  return (
    <div
      id="viz-panel"
      className={visible ? undefined : "hidden"}
      ref={handlePanelRef}
    >
      <div id="jukebox-viz" className="viz">
        <BranchStatsPopup />
        <ModifierBadges />
        <div className="viz-top">
          <VizTop />
        </div>
        <div id="viz-layer" className="viz-layer" ref={vizLayerRef}></div>
        <div
          className={vizStatsPulseId > 0 ? "viz-bottom pulse" : "viz-bottom"}
          id="viz-stats"
          key={vizStatsPulseId}
        >
          <div className="viz-bottom-left">
            <div className="viz-play-controls">
              <PlayControls />
            </div>
            <div className="viz-info">
              <VizInfo />
            </div>
          </div>
          <div className="viz-bottom-right">
            <VizBottomRight />
          </div>
        </div>
      </div>
    </div>
  );
}
