import { describe, expect, it } from "vitest";
import { styleForGenres, styleForTitle } from "./vizStyle";

const g = (...pairs: Array<[string, number]>) =>
  pairs.map(([label, score]) => ({ label, score }));

describe("styleForGenres", () => {
  it("maps the analyzed songs' top styles to fitting visuals", () => {
    expect(styleForGenres(g(["Folk, World, & Country---Folk", 0.28], ["Folk, World, & Country---Country", 0.21], ["Pop---Ballad", 0.07]))).toBe("rustic");
    expect(styleForGenres(g(["Hip Hop---Cloud Rap", 0.65], ["Hip Hop---Trap", 0.19]))).toBe("street");
    expect(styleForGenres(g(["Rock---Shoegaze", 0.16], ["Rock---Dream Pop", 0.09], ["Rock---Post-Punk", 0.08]))).toBe("psychedelic");
    expect(styleForGenres(g(["Electronic---Trance", 0.57], ["Electronic---Euro House", 0.26]))).toBe("cyberpunk");
    expect(styleForGenres(g(["Electronic---Ambient", 0.18], ["Classical---Contemporary", 0.07]))).toBe("celestial");
    expect(styleForGenres(g(["Electronic---Happy Hardcore", 0.3], ["Electronic---Dance-pop", 0.17], ["Electronic---Hardcore", 0.13]))).toBe("bubblegum");
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
