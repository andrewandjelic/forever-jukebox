import type { SyntheticEvent } from "react";
import { PlayMenu } from "./PlayMenu";
import { StatusPanel } from "./StatusPanel";
import { VizContainer } from "./VizContainer";

// A button clicked or a dropdown picked from with the mouse keeps focus, and
// a focused control swallows the playback shortcuts: Space would press that
// button again instead of pausing, and Shift, E and the arrows would do
// nothing or change the dropdown. Hand focus back to the page unless the
// control was reached by keyboard, where keeping it is the point.
function releaseMouseFocus(event: SyntheticEvent) {
  const control =
    event.target instanceof Element
      ? event.target.closest("button, select, a")
      : null;
  if (!(control instanceof HTMLElement) || document.activeElement !== control) {
    return;
  }
  let reachedByKeyboard = false;
  try {
    reachedByKeyboard = control.matches(":focus-visible");
  } catch {
    // No :focus-visible support: treat the control as clicked.
  }
  if (!reachedByKeyboard) {
    control.blur();
  }
}

// The Listen panel. It persists in the DOM permanently — visibility is
// class-only, driven by the shell.
export function ListenPanel({ visible }: { visible: boolean }) {
  return (
    <section
      className={visible ? "panel tab-panel" : "panel tab-panel hidden"}
      data-tab-panel="play"
      onClick={releaseMouseFocus}
      onChange={releaseMouseFocus}
    >
      <StatusPanel />
      <PlayMenu />
      <VizContainer />
    </section>
  );
}
