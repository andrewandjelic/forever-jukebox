// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { startBeatPound, stopBeatPound } from "./beatPound";
import { applyStyle, styleForGenres, styleForTitle } from "./vizStyle";

vi.mock("./beatPound", () => ({
  startBeatPound: vi.fn(),
  stopBeatPound: vi.fn(),
}));
vi.mock("./runtime", () => ({
  getAppContext: () => ({ jukebox: { refresh: vi.fn() } }),
}));

const g = (...pairs: Array<[string, number]>) =>
  pairs.map(([label, score]) => ({ label, score }));

describe("styleForGenres", () => {
  it("maps the analyzed songs' top styles to fitting visuals", () => {
    expect(styleForGenres(g(["Folk, World, & Country---Folk", 0.28], ["Folk, World, & Country---Country", 0.21], ["Pop---Ballad", 0.07]))).toBe("rustic");
    expect(styleForGenres(g(["Hip Hop---Cloud Rap", 0.65], ["Hip Hop---Trap", 0.19]))).toBe("street");
    expect(styleForGenres(g(["Rock---Shoegaze", 0.16], ["Rock---Dream Pop", 0.09], ["Rock---Post-Punk", 0.08]))).toBe("moth");
    expect(styleForGenres(g(["Rock---Indie Rock", 0.3], ["Pop---Indie Pop", 0.1]))).toBe("moth");
    expect(styleForGenres(g(["Rock---Psychedelic Rock", 0.4], ["Rock---Space Rock", 0.1]))).toBe("psychedelic");
    expect(styleForGenres(g(["Electronic---Trance", 0.57], ["Electronic---Euro House", 0.26]))).toBe("cyberpunk");
    expect(styleForGenres(g(["Electronic---Ambient", 0.18], ["Classical---Contemporary", 0.07]))).toBe("celestial");
    expect(styleForGenres(g(["Electronic---Happy Hardcore", 0.3], ["Electronic---Dance-pop", 0.17], ["Electronic---Hardcore", 0.13]))).toBe("bubblegum");
  });

  it("gives dark techno, extreme metal and goth the pounding Doom style", () => {
    expect(styleForGenres(g(["Electronic---Techno", 0.4], ["Electronic---Hard Techno", 0.2]))).toBe("doom");
    expect(styleForGenres(g(["Electronic---Industrial", 0.3], ["Electronic---EBM", 0.2]))).toBe("doom");
    expect(styleForGenres(g(["Rock---Black Metal", 0.5], ["Rock---Heavy Metal", 0.1]))).toBe("doom");
    expect(styleForGenres(g(["Rock---Goth Rock", 0.3], ["Electronic---Darkwave", 0.2]))).toBe("doom");
    // Dark Ambient is doom, plain Ambient stays celestial.
    expect(styleForGenres(g(["Electronic---Dark Ambient", 0.4]))).toBe("doom");
    // Classic heavy metal and heavy bass keep Inferno.
    expect(styleForGenres(g(["Rock---Heavy Metal", 0.5], ["Rock---Thrash", 0.2]))).toBe("inferno");
    expect(styleForGenres(g(["Electronic---Dubstep", 0.5]))).toBe("inferno");
  });

  it("adds up related styles, so several weaker matches can beat one stronger", () => {
    // Smuglianka: Opera alone outscores Military, but Military + Marches win.
    expect(styleForGenres(g(["Classical---Opera", 0.21], ["Brass & Military---Military", 0.2], ["Brass & Military---Marches", 0.15]))).toBe("soviet");
  });

  it("returns null when nothing is known", () => {
    expect(styleForGenres(null)).toBeNull();
    expect(styleForGenres(g(["Children's---Nursery Rhymes", 0.9]))).toBeNull();
  });
});

describe("styleForTitle", () => {
  it("spots unmistakable names regardless of genre", () => {
    expect(styleForTitle("Come Out ye Black and Tans (BEAT REMIX)")).toBe("irish");
    expect(styleForTitle("Red Army Choir Smuglianka")).toBe("soviet");
    expect(styleForTitle("Darude - Sandstorm")).toBeNull();
    expect(styleForTitle(null)).toBeNull();
  });
});

describe("applyStyle", () => {
  it("pulses on the beat only in styles that ask for it, at their own pace", () => {
    applyStyle("doom");
    expect(document.body.dataset.style).toBe("doom");
    expect(startBeatPound).toHaveBeenLastCalledWith(0.12);

    applyStyle("moth");
    expect(startBeatPound).toHaveBeenLastCalledWith(0.45);

    applyStyle("cyberpunk");
    expect(stopBeatPound).toHaveBeenCalledTimes(1);
    expect(startBeatPound).toHaveBeenCalledTimes(2);
  });
});
