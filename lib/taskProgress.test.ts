import { describe, expect, it } from "vitest";
import type { ProjectItem } from "@/lib/types";
import {
  formatProgressFraction,
  generalTaskProgress,
  progressForContentNode,
  progressForProjectItem,
} from "@/lib/taskProgress";

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

describe("progressForContentNode (N-nivel)", () => {
  it("usa hijos inmediatos por parentIssueContentId", () => {
    const items = [
      item({
        parentTaskId: "ROOT",
        contentNodeId: "I_mid",
        parentIssueContentId: "I_root",
        fieldValues: { Status: "Todo" },
      }),
      item({
        parentTaskId: "ROOT",
        contentNodeId: "I_leaf",
        parentIssueContentId: "I_mid",
        fieldValues: { Status: "Done" },
      }),
    ];
    const root = progressForContentNode("I_root", items);
    expect(root).toEqual({ total: 1, done: 0, open: 1, percent: 0 });

    const mid = progressForProjectItem(
      items.find((i) => i.contentNodeId === "I_mid")!,
      items,
    );
    expect(mid).toEqual({ total: 1, done: 1, open: 0, percent: 100 });
  });

  it("prefiere subIssuesSummary de GitHub", () => {
    const p = progressForContentNode("I_root", [], {
      total: 12,
      completed: 3,
      percentCompleted: 25,
    });
    expect(p).toEqual({ total: 12, done: 3, open: 9, percent: 25 });
    expect(formatProgressFraction(p)).toBe("3 / 12 · 25%");
  });
});
