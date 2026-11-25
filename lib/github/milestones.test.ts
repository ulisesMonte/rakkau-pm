import { describe, expect, it } from "vitest";
import type { ProjectDocument, Sprint } from "@/lib/types";
import {
  collectSprintIssueTargets,
  mergeSprintsFromMilestones,
} from "@/lib/github/milestones";

const baseDoc = (): ProjectDocument => ({
  projectId: "PVT_test",
  number: 1,
  title: "Test",
  owner: "user",
  pulledAt: null,
  dirty: false,
  fields: [],
  generalTasks: [
    {
      id: "T1",
      title: "Root",
      Sprint: "Sprint 3",
      githubContentNodeId: "I_root",
      repository: "acme/ops",
    },
  ],
  items: [
    {
      nodeId: "PVTI_1",
      contentNodeId: "I_child",
      number: 2,
      title: "Child",
      state: "OPEN",
      url: null,
      contentType: "Issue",
      fieldValues: { Sprint: "Sprint 3" },
      parentTaskId: "T1",
      assignees: [],
      repository: "acme/ops",
    },
  ],
  links: { blockedBy: {}, blocks: {} },
});

describe("collectSprintIssueTargets", () => {
  it("collects issues matching sprint name", () => {
    const sprint: Sprint = {
      id: "sp-1",
      name: "Sprint 3",
      quarter: "Q4",
      year: 2026,
      status: "active",
    };
    const targets = collectSprintIssueTargets(baseDoc(), sprint);
    expect(targets.map((t) => t.contentNodeId).sort()).toEqual([
      "I_child",
      "I_root",
    ]);
  });
});

describe("mergeSprintsFromMilestones", () => {
  it("creates local sprints from milestone titles", () => {
    const items = [
      {
        ...baseDoc().items[0],
        milestoneId: "M_1",
        milestoneTitle: "Sprint Alpha",
        milestoneDueOn: "2026-12-15T12:00:00Z",
        repository: "acme/ops",
      },
    ];
    const merged = mergeSprintsFromMilestones([], items, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Sprint Alpha");
    expect(merged[0].endDate).toBe("2026-12-15");
    expect(merged[0].githubMilestoneIdsByRepo?.["acme/ops"]).toBe("M_1");
  });

  it("preserves existing local sprints", () => {
    const existing: Sprint[] = [
      {
        id: "sp-local",
        name: "Sprint Alpha",
        quarter: "Q4",
        year: 2026,
        status: "planned",
        color: "#2dd4bf",
      },
    ];
    const items = [
      {
        ...baseDoc().items[0],
        milestoneId: "M_1",
        milestoneTitle: "Sprint Alpha",
        repository: "acme/ops",
      },
    ];
    const merged = mergeSprintsFromMilestones(existing, items, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("sp-local");
    expect(merged[0].color).toBe("#2dd4bf");
    expect(merged[0].githubMilestoneIdsByRepo?.["acme/ops"]).toBe("M_1");
  });
});
