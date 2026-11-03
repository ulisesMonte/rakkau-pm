import { describe, expect, it } from "vitest";
import {
  progressFillClass,
  progressTone,
  statusIsBlocked,
} from "./progressView";

describe("progressView", () => {
  it("tones percent bands", () => {
    expect(progressTone(null)).toBe("empty");
    expect(progressTone(0)).toBe("low");
    expect(progressTone(29)).toBe("low");
    expect(progressTone(30)).toBe("mid");
    expect(progressTone(69)).toBe("mid");
    expect(progressTone(70)).toBe("good");
    expect(progressTone(100)).toBe("good");
  });

  it("maps fill class from progress", () => {
    expect(
      progressFillClass({ total: 0, done: 0, open: 0, percent: null }),
    ).toBe("");
    expect(
      progressFillClass({ total: 4, done: 1, open: 3, percent: 25 }),
    ).toBe("rk-progress-fill--low");
    expect(
      progressFillClass({ total: 2, done: 1, open: 1, percent: 50 }),
    ).toBe("rk-progress-fill--mid");
    expect(
      progressFillClass({ total: 5, done: 4, open: 1, percent: 80 }),
    ).toBe("rk-progress-fill--good");
  });

  it("detects Status Bloqueado", () => {
    expect(statusIsBlocked("Bloqueado")).toBe(true);
    expect(statusIsBlocked("bloqueado")).toBe(true);
    expect(statusIsBlocked("In Progress")).toBe(false);
    expect(statusIsBlocked(undefined)).toBe(false);
  });
});
