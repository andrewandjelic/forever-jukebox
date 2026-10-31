import { describe, expect, it } from "vitest";
import {
  formatCursorTime,
  formatDuration,
  formatListenMultiplier,
  formatTrackDuration,
  listenMultiplierTenths,
} from "./format";

describe("format", () => {
  it("formats duration as hh:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(61)).toBe("00:01:01");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("formats track duration as m:ss, adding hours only when needed", () => {
    expect(formatTrackDuration("nope")).toBe("-");
    expect(formatTrackDuration(Number.NaN)).toBe("-");
    expect(formatTrackDuration(1)).toBe("0:01");
    expect(formatTrackDuration(61)).toBe("1:01");
    expect(formatTrackDuration(3599)).toBe("59:59");
    expect(formatTrackDuration(3661)).toBe("1:01:01");
  });

  it("formats cursor times with unbounded minutes", () => {
    expect(formatCursorTime(0)).toBe("0:00");
    expect(formatCursorTime(125)).toBe("2:05");
    expect(formatCursorTime(3735)).toBe("62:15");
  });

  it("counts listen time in whole tenths of the song's length", () => {
    expect(listenMultiplierTenths(0, 120)).toBe(0);
    expect(listenMultiplierTenths(11.9, 120)).toBe(0);
    expect(listenMultiplierTenths(12, 120)).toBe(1);
    // 0.7 * 10 is 7.000000000000001 in floats; the tenth must land exactly.
    expect(listenMultiplierTenths(84, 120)).toBe(7);
    expect(listenMultiplierTenths(504, 120)).toBe(42);
    expect(listenMultiplierTenths(-5, 120)).toBe(0);
    expect(listenMultiplierTenths(60, null)).toBeNull();
    expect(listenMultiplierTenths(60, 0)).toBeNull();
    expect(listenMultiplierTenths(60, Number.NaN)).toBeNull();
  });

  it("formats the multiplier with one decimal in the locale", () => {
    expect(formatListenMultiplier(0, "en")).toBe("0.0");
    expect(formatListenMultiplier(42, "en")).toBe("4.2");
    expect(formatListenMultiplier(1234, "en")).toBe("123.4");
    expect(formatListenMultiplier(42, "de")).toBe("4,2");
  });
});
