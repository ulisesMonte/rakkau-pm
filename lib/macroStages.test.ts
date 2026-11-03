import { describe, expect, it } from "vitest";
import {
  createDefaultStages,
  quarterDateRange,
  stageProgress,
  suggestStageDueDates,
} from "@/lib/macroStages";

describe("macroStages", () => {
  it("quarterDateRange Q1 2026", () => {
    expect(quarterDateRange("Q1", 2026)).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    });
  });

  it("suggestStageDueDates reparte fechas en el Q", () => {
    const dues = suggestStageDueDates("Q1", 2026, 4);
    expect(dues).toHaveLength(4);
    expect(dues[0] >= "2026-01-01").toBe(true);
    expect(dues[3]).toBe("2026-03-31");
  });

  it("createDefaultStages y stageProgress", () => {
    const stages = createDefaultStages("Q2", 2026, 3);
    expect(stages).toHaveLength(3);
    expect(stages[0].name).toBe("Etapa 1");
    expect(stageProgress(stages).percent).toBe(0);
    stages[0].done = true;
    stages[1].done = true;
    expect(stageProgress(stages).percent).toBe(67);
  });
});
