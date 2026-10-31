import { describe, expect, it } from "vitest";
import { formatListenMultiplier, listenMultiplierTenths } from "../format";

describe("listen multiplier", () => {
  it("counts listen time in whole tenths of the song's length", () => {
    expect(listenMultiplierTenths(0, 120)).toBe(0);
    expect(listenMultiplierTenths(11.9, 120)).toBe(0);
    expect(listenMultiplierTenths(12, 120)).toBe(1);
    expect(listenMultiplierTenths(84, 120)).toBe(7);
    expect(listenMultiplierTenths(504, 120)).toBe(42);
    expect(listenMultiplierTenths(60, 0)).toBeNull();
    expect(listenMultiplierTenths(60, Number.NaN)).toBeNull();
  });

  it("formats the multiplier with one decimal in the locale", () => {
    expect(formatListenMultiplier(0, "en")).toBe("0.0");
    expect(formatListenMultiplier(42, "en")).toBe("4.2");
    expect(formatListenMultiplier(42, "de")).toBe("4,2");
  });
});
