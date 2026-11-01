import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../../i18n";
import { VizInfo } from "./VizInfo";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("VizInfo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderInfo(listenSeconds: number, trackDurationSeconds: number) {
    act(() => {
      root.render(
        <VizInfo
          vizTitleRef={() => {}}
          trackDurationSeconds={trackDurationSeconds}
          listenSeconds={listenSeconds}
          beatsLabel="Total Beats:"
          beatsPlayed={0}
          bringItHomeMode={false}
        />,
      );
    });
    return container.querySelector("#listen-multiplier");
  }

  it("shows listen time as a multiple of the song", () => {
    const multiplier = renderInfo(504, 120);
    expect(multiplier?.textContent).toBe("4.2× original");
    expect(multiplier?.getAttribute("title")).toBe(
      "You've listened 4.2 times as long as the original song",
    );
  });

  it("hides the multiplier without a song length", () => {
    expect(renderInfo(504, 0)).toBeNull();
  });
});
