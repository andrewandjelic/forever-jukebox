import { expect, test } from "@playwright/test";
import { loadFirstTopTrack, setRangeValue } from "./helpers";

test.describe("removed play modes", () => {
  test("a deep link with an old mode param plays in the jukebox", async ({
    page,
  }) => {
    const trackId = await loadFirstTopTrack(page);
    await page.goto(`/listen/${trackId}?mode=autocanonizer`);
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#play-mode-select")).toHaveCount(0);
    await expect(page.locator("#viz-layer")).toBeVisible();
    await expect(page.locator("#viz-select")).toBeEnabled();
    await expect(page.locator("#tuning")).not.toHaveClass(/is-hidden/);
  });
});

test.describe("visualization selector", () => {
  test("sorted options, selection persists to fj-viz and across reload", async ({
    page,
  }) => {
    const trackId = await loadFirstTopTrack(page);
    const select = page.locator("#viz-select");
    await expect(select).toBeEnabled();
    const labels = await select.locator("option").allTextContents();
    expect(labels).toEqual([...labels].sort());
    expect(labels).toContain("Classic");

    await select.selectOption({ label: "Galaxy" });
    expect(await page.evaluate(() => localStorage.getItem("fj-viz"))).toBe(
      "2",
    );

    await page.goto(`/listen/${trackId}`);
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#viz-select")).toHaveValue("2");
  });

  test("viz select is disabled before a track loads", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-tab-button="play"]').click();
    await expect(page.locator("#viz-select")).toBeDisabled();
  });
});

test.describe("volume + fullscreen", () => {
  test("volume panel toggles, slider updates label, click-away closes", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    const panel = page.locator("#volume-control-panel");
    await expect(panel).toHaveClass(/is-hidden/);
    await page.locator("#volume-button").click();
    await expect(panel).not.toHaveClass(/is-hidden/);
    await expect(page.locator("#volume-val")).toHaveText("100");

    await setRangeValue(page, "#volume", "75");
    await expect(page.locator("#volume-val")).toHaveText("75");

    // click a static element (the marquee title animates and never settles)
    await page.locator("#listen-time").click();
    await expect(panel).toHaveClass(/is-hidden/);
  });

  test("fullscreen toggle round trip", async ({ page }) => {
    await loadFirstTopTrack(page);
    const button = page.locator("#fullscreen");
    await expect(button).toHaveAttribute("aria-label", "Fullscreen");
    await button.click();
    const entered = await page
      .waitForFunction(() => document.fullscreenElement !== null, undefined, {
        timeout: 5_000,
      })
      .then(() => true)
      .catch(() => false);
    test.skip(!entered, "environment does not support fullscreen");
    await expect(button).toHaveAttribute("aria-label", "Exit Fullscreen");
    await expect(button.locator(".fullscreen-icon")).toHaveText(
      "fullscreen_exit",
    );
    await button.click();
    await expect(button).toHaveAttribute("aria-label", "Fullscreen");
  });
});
