import { describe, expect, it } from "vitest";
import { tuneFormChanged, type TuneFormState } from "./tuning";

const FORM: TuneFormState = {
  threshold: 30,
  computedThreshold: 30,
  minProb: 18,
  maxProb: 50,
  ramp: 10,
  volume: 50,
  highlightAnchorBranch: false,
  justBackwards: false,
  minLongBranchPercent: 0,
  removeSequentialBranches: false,
};

describe("tuneFormChanged", () => {
  it("ignores volume, anchor highlight, and computed threshold", () => {
    expect(
      tuneFormChanged(FORM, {
        ...FORM,
        volume: 80,
        highlightAnchorBranch: true,
        computedThreshold: 35,
      }),
    ).toBe(false);
  });

  it("flags tuning edits", () => {
    expect(tuneFormChanged(FORM, { ...FORM, threshold: 40 })).toBe(true);
    expect(tuneFormChanged(FORM, { ...FORM, minLongBranchPercent: 10 })).toBe(true);
    expect(tuneFormChanged(FORM, { ...FORM, justBackwards: true })).toBe(true);
  });
});
