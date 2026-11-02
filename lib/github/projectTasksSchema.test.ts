import { describe, expect, it } from "vitest";
import type { ProjectDocument, ProjectItem } from "@/lib/types";
import { rebuildProjectHierarchyFromGitHub } from "@/lib/github/issueHierarchy";
import {
  mapGitHubProjectItems,
  mergeTasksAfterPush,
  PROJECT_TASKS_SCHEMA_VERSION,
} from "@/lib/github/projectTasksSchema";
import { normalizeProjectHierarchy } from "@/lib/github/projectInvariants";

const baseDoc = (): ProjectDocument => ({
  projectId: "PVT_test",
  number: 1,
  title: "Test",
  owner: "user",
  pulledAt: null,
  dirty: false,
  fields: [],
  generalTasks: [],
  items: [],
  links: { blockedBy: {}, blocks: {} },
});

describe("projectTasksSchema", () => {
  it("maps sub-issue parent from GitHub nodes", () => {
    const items = mapGitHubProjectItems([
      {
        id: "PVTI_parent",
        content: {
          __typename: "Issue",
          id: "I_parent",
          number: 10,
          title: "TEST-1111",
          state: "OPEN",
          subIssues: { nodes: [{ id: "I_child" }] },
        },
        fieldValues: { nodes: [] },
      },
      {
        id: "PVTI_child",
        content: {
          __typename: "Issue",
          id: "I_child",
          number: 11,
          title: "test-3333",
          state: "OPEN",
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldTextValue",
              text: "TEST-1111",
              field: { name: "Task" },
            },
          ],
        },
      },
    ]);
    const child = items.find((i) => i.number === 11);
    expect(child?.parentIssueContentId).toBe("I_parent");
  });

  it("mergeTasksAfterPush keeps remote generalTasks", () => {
    const remote = baseDoc();
    remote.generalTasks = [
      {
        id: "TEST-1111",
        title: "TEST-1111",
        githubProjectItemNodeId: "PVTI_p",
        githubContentNodeId: "I_parent",
        issueNumber: 10,
        url: null,
      },
    ];
    remote.items = [
      {
        nodeId: "PVTI_c",
        contentNodeId: "I_child",
        number: 11,
        title: "sub",
        state: "OPEN",
        url: null,
        contentType: "Issue",
        fieldValues: { Task: ["TEST-1111"] },
        parentTaskId: "TEST-1111",
        parentIssueContentId: "I_parent",
        assignees: [],
      },
    ];
    const pushed = structuredClone(remote);
    pushed.generalTasks[0].Status = "Todo";

    const merged = mergeTasksAfterPush(pushed, remote);
    expect(merged.generalTasks.length).toBe(1);
    expect(merged.generalTasks[0].Status).toBe("Todo");
    expect(merged.tasksSchemaVersion).toBe(PROJECT_TASKS_SCHEMA_VERSION);
  });

  it("normalize creates parent when only subtask on board", () => {
    const flat: ProjectItem[] = [
      {
        nodeId: "PVTI_c",
        contentNodeId: "I_child",
        number: 11,
        title: "sub",
        state: "OPEN",
        url: null,
        contentType: "Issue",
        fieldValues: { Task: ["TEST-1111"] },
        parentTaskId: "TEST-1111",
        parentIssueContentId: "I_parent",
        assignees: [],
      },
    ];
    let doc = rebuildProjectHierarchyFromGitHub({
      ...baseDoc(),
      items: flat,
    });
    doc = normalizeProjectHierarchy(doc);
    expect(doc.generalTasks.some((g) => g.id === "TEST-1111")).toBe(true);
  });
});
