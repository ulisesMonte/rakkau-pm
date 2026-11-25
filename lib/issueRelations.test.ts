import { describe, expect, it } from "vitest";
import {
  formatRelationLabels,
  isBlockedByRelations,
  isBlockingRelations,
} from "@/lib/issueRelations";

describe("issueRelations", () => {
  it("detects blocked / blocking", () => {
    expect(isBlockedByRelations(["I_1"])).toBe(true);
    expect(isBlockedByRelations([])).toBe(false);
    expect(isBlockingRelations(undefined)).toBe(false);
    expect(isBlockingRelations(["I_2"])).toBe(true);
  });

  it("formats labels from lookup", () => {
    const lookup = new Map([
      ["I_1", { number: 10, title: "Auth" }],
      ["I_2", { number: 11, title: null }],
    ]);
    expect(formatRelationLabels(["I_1", "I_2", "I_unknown"], lookup)).toEqual([
      "#10 Auth",
      "#11",
      "I_unknown",
    ]);
  });
});
