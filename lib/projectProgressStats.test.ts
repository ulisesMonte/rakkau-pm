import { describe, expect, it } from "vitest";
import type { ProjectDocument, ProjectItem } from "@/lib/types";
import { computeProjectProgressStats } from "@/lib/projectProgressStats";

function bareDoc(partial: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    projectId: "PVT_test",
    number: 2,
    title: "Telecom",
    owner: "rakkau",
    pulledAt: null,
    dirty: false,
    fields: [],
    generalTasks: [],
    items: [],
    links: { blockedBy: {}, blocks: {} },
    ...partial,
  };
}

function item(
  partial: Partial<ProjectItem> & {
    nodeId: string;
    contentNodeId: string;
    title: string;
  },
): ProjectItem {
  return {
    number: null,
    state: "OPEN",
    url: null,
    contentType: "Issue",
    fieldValues: {},
    parentTaskId: null,
    assignees: [],
    ...partial,
  };
}

describe("computeProjectProgressStats", () => {
  it("default active ignora Done histórico y rollupea sub-issues", () => {
    const doc = bareDoc({
      generalTasks: [
        {
          id: "done-root",
          title: "Vieja",
          Status: "Done",
          githubContentNodeId: "I_old",
          issueNumber: 1,
          subIssuesSummary: { total: 10, completed: 10, percentCompleted: 100 },
        },
        {
          id: "hornos-prod",
          title: "Hornos - PROD",
          Status: "Infraestructura",
          githubContentNodeId: "I_67",
          issueNumber: 67,
          issueType: { name: "Feature" },
          labels: [
            { name: "kind/feat", color: "a2eeef" },
            { name: "scope/am", color: "5319e7" },
          ],
          assignees: ["tobias-calvo"],
          subIssuesSummary: { total: 5, completed: 0, percentCompleted: 0 },
        },
        {
          id: "du-rel",
          title: "DU - Release",
          Status: "DigitalUser",
          githubContentNodeId: "I_545",
          issueNumber: 545,
          issueType: { name: "Task" },
          labels: [{ name: "scope/idm", color: "3742F9" }],
          assignees: ["letroncoso"],
          subIssuesSummary: { total: 6, completed: 0, percentCompleted: 0 },
        },
      ],
      items: [
        item({
          nodeId: "PVTI_69",
          contentNodeId: "I_69",
          number: 69,
          title: "Config",
          parentTaskId: "hornos-prod",
          parentIssueContentId: "I_67",
          fieldValues: { Status: "Infraestructura" },
          issueType: { name: "Feature" },
          labels: [{ name: "scope/am", color: "5319e7" }],
          assignees: ["tobias-calvo"],
          subIssuesSummary: { total: 15, completed: 1, percentCompleted: 6 },
        }),
        item({
          nodeId: "PVTI_71",
          contentNodeId: "I_71",
          number: 71,
          title: "Despliegue",
          parentTaskId: "hornos-prod",
          parentIssueContentId: "I_69",
          fieldValues: { Status: "Done" },
          state: "CLOSED",
          issueType: { name: "Task" },
          assignees: ["tobias-calvo"],
        }),
      ],
    });

    const active = computeProjectProgressStats(doc, "active");
    expect(active.boardTotal).toBe(5);
    expect(active.doneHistoric).toBe(2); // Vieja + item Done
    expect(active.activeTotal).toBe(3);
    expect(active.totalInScope).toBe(3);
    // Rollup: Hornos 0/5 + DU 0/6 + Config 1/15 (Config es mid-parent activo)
    expect(active.subIssuesRollup.total).toBe(5 + 6 + 15);
    expect(active.subIssuesRollup.done).toBe(1);
    expect(active.subIssuesRollup.percent).toBe(Math.round((1 / 26) * 100));
    // 0% primero; a empate gana el de más open (DU 6 > Hornos 5).
    expect(active.focus[0]?.progress.percent).toBe(0);
    expect(active.focus.map((f) => f.issueNumber)).toEqual(
      expect.arrayContaining([67, 545, 69]),
    );
    expect(active.byStatus.some((b) => b.label === "Infraestructura")).toBe(
      true,
    );
    expect(active.byScopeLabel.map((b) => b.label)).toEqual(
      expect.arrayContaining(["scope/am", "scope/idm"]),
    );
    expect(
      active.byScopeLabel.find((b) => b.label === "scope/am")?.count,
    ).toBe(2);

    const all = computeProjectProgressStats(doc, "all");
    expect(all.totalInScope).toBe(5);
    expect(all.subIssuesRollup.total).toBe(10 + 5 + 6 + 15);
  });
});
