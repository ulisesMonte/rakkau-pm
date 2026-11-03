import { describe, expect, it } from "vitest";
import type { ProjectItem } from "@/lib/types";
import { generalTaskProgress } from "@/lib/taskProgress";

function item(
  partial: Partial<ProjectItem> & { parentTaskId: string | null },
): ProjectItem {
  return {
    nodeId: `n_${Math.random().toString(36).slice(2, 8)}`,
    number: null,
    title: "sub",
    state: "OPEN",
    url: null,
    contentType: "Issue",
    fieldValues: {},
    assignees: [],
    ...partial,
  };
}

describe("generalTaskProgress", () => {
  it("devuelve percent null sin subtareas", () => {
    expect(generalTaskProgress("T1", [])).toEqual({
      total: 0,
      done: 0,
      open: 0,
      percent: null,
    });
  });

  it("calcula % por subtareas cerradas", () => {
    const items = [
      item({ parentTaskId: "T1", state: "CLOSED", fieldValues: { Status: "Done" } }),
      item({ parentTaskId: "T1", state: "OPEN", fieldValues: { Status: "Todo" } }),
      item({ parentTaskId: "T1", state: "OPEN", fieldValues: { Status: "In Progress" } }),
      item({ parentTaskId: "OTHER", state: "CLOSED", fieldValues: { Status: "Done" } }),
    ];
    const p = generalTaskProgress("T1", items);
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.open).toBe(2);
    expect(p.percent).toBe(33);
  });

  it("100% cuando todas cerradas", () => {
    const items = [
      item({ parentTaskId: "T1", state: "CLOSED" }),
      item({ parentTaskId: "T1", fieldValues: { Status: "Done" } }),
    ];
    expect(generalTaskProgress("T1", items).percent).toBe(100);
  });
});
