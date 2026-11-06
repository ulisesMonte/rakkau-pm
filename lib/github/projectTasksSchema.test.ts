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
          subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
          labels: {
            nodes: [{ name: "good first issue", color: "7057ff" }],
          },
          issueType: {
            id: "IT_1",
            name: "Feature",
            color: "BLUE",
            description: "A request, idea, or new functionality",
          },
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldLabelValue",
              labels: {
                nodes: [
                  { name: "good first issue", color: "7057ff" },
                  { name: "priority", color: "d73a4a" },
                ],
              },
              field: { name: "Labels" },
            },
          ],
        },
      },
      {
        id: "PVTI_child",
        content: {
          __typename: "Issue",
          id: "I_child",
          number: 11,
          title: "test-3333",
          state: "OPEN",
          parent: { id: "I_parent" },
          issueType: { name: "Bug", color: "RED" },
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
    expect(child?.issueType?.name).toBe("Bug");
    const parent = items.find((i) => i.number === 10);
    expect(parent?.subIssuesSummary?.total).toBe(1);
    expect(parent?.labels?.map((l) => l.name)).toEqual([
      "good first issue",
      "priority",
    ]);
    expect(parent?.issueType?.name).toBe("Feature");
  });

  it("marks title -D as dependencia (isDependency + HasDependency)", () => {
    const items = mapGitHubProjectItems([
      {
        id: "PVTI_dep",
        content: {
          __typename: "Issue",
          id: "I_dep",
          number: 42,
          title: "crear bc box kubernets -D",
          state: "OPEN",
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              name: "fcliente",
              field: { name: "Responsable" },
            },
          ],
        },
      },
      {
        id: "PVTI_plain",
        content: {
          __typename: "Issue",
          id: "I_plain",
          number: 43,
          title: "tarea normal",
          state: "OPEN",
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              name: "rakkau",
              field: { name: "Responsable" },
            },
          ],
        },
      },
    ]);
    const dep = items.find((i) => i.number === 42);
    const plain = items.find((i) => i.number === 43);
    expect(dep?.isDependency).toBe(true);
    expect(dep?.fieldValues.HasDependency).toBe("Sí");
    expect(dep?.fieldValues.Responsable).toBe("cliente");
    expect(plain?.isDependency).toBeUndefined();
    expect(plain?.fieldValues.HasDependency).toBeUndefined();
    expect(plain?.fieldValues.Responsable).toBe("rakkau");

    const doc = baseDoc();
    doc.items = items;
    const rebuilt = rebuildProjectHierarchyFromGitHub(doc);
    const gtDep = rebuilt.generalTasks.find((g) => g.issueNumber === 42);
    expect(gtDep?.isDependency).toBe(true);
    expect(gtDep?.HasDependency).toBe("Sí");
    expect(gtDep?.Responsable).toBe("cliente");
  });

  it("maps N-level parents (mid-level keeps parentIssueContentId)", () => {
    const items = mapGitHubProjectItems([
      {
        id: "PVTI_root",
        content: {
          __typename: "Issue",
          id: "I_root",
          number: 67,
          title: "Hornos - PROD",
          state: "OPEN",
          subIssues: { nodes: [{ id: "I_mid" }] },
          subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
        },
        fieldValues: { nodes: [] },
      },
      {
        id: "PVTI_mid",
        content: {
          __typename: "Issue",
          id: "I_mid",
          number: 68,
          title: "Plan",
          state: "OPEN",
          parent: { id: "I_root" },
          subIssues: { nodes: [{ id: "I_leaf" }] },
          subIssuesSummary: { total: 1, completed: 1, percentCompleted: 100 },
        },
        fieldValues: { nodes: [] },
      },
      {
        id: "PVTI_leaf",
        content: {
          __typename: "Issue",
          id: "I_leaf",
          number: 70,
          title: "RS-CTS",
          state: "CLOSED",
          parent: { id: "I_mid" },
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              name: "Done",
              field: { name: "Status" },
            },
          ],
        },
      },
    ]);

    let doc = rebuildProjectHierarchyFromGitHub({
      ...baseDoc(),
      items,
    });
    doc = normalizeProjectHierarchy(doc);

    expect(doc.generalTasks).toHaveLength(1);
    expect(doc.generalTasks[0].issueNumber).toBe(67);
    expect(doc.items).toHaveLength(2);

    const mid = doc.items.find((i) => i.number === 68);
    const leaf = doc.items.find((i) => i.number === 70);
    expect(mid?.parentIssueContentId).toBe("I_root");
    expect(leaf?.parentIssueContentId).toBe("I_mid");
    // Mid-level stays as item (not promoted to generalTask).
    expect(doc.generalTasks.some((g) => g.issueNumber === 68)).toBe(false);
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

  it("mergeTasksAfterPush keeps local githubFieldValues (Track / Journey)", () => {
    const remote = baseDoc();
    remote.generalTasks = [
      {
        id: "TEST-1111",
        title: "TEST-1111",
        githubProjectItemNodeId: "PVTI_p",
        githubContentNodeId: "I_parent",
        issueNumber: 10,
        url: null,
        githubFieldValues: { "Track / Journey": "Platform" },
      },
    ];
    const pushed = structuredClone(remote);
    pushed.generalTasks[0].githubFieldValues = {
      "Track / Journey": "Identity",
    };

    const merged = mergeTasksAfterPush(pushed, remote);
    expect(merged.generalTasks[0].githubFieldValues?.["Track / Journey"]).toBe(
      "Identity",
    );
  });

  it("disambiguates root generalTasks with the same title", () => {
    const items = mapGitHubProjectItems([
      {
        id: "PVTI_a",
        content: {
          __typename: "Issue",
          id: "I_a",
          number: 223,
          title: "Digital User - AM - Key renewal",
          state: "OPEN",
        },
        fieldValues: { nodes: [] },
      },
      {
        id: "PVTI_b",
        content: {
          __typename: "Issue",
          id: "I_b",
          number: 254,
          title: "Digital User - AM - Key renewal",
          state: "OPEN",
        },
        fieldValues: { nodes: [] },
      },
    ]);
    const doc = rebuildProjectHierarchyFromGitHub({
      ...baseDoc(),
      items,
    });
    expect(doc.generalTasks).toHaveLength(2);
    const ids = doc.generalTasks.map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((id) => id.includes("#254") || id.includes("#223"))).toBe(
      true,
    );
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

  it("maps parent title/number from Issue.parent", () => {
    const items = mapGitHubProjectItems([
      {
        id: "PVTI_c",
        content: {
          __typename: "Issue",
          id: "I_child",
          number: 525,
          title: "DU - IDM - Inconveniente con el Cluster",
          state: "CLOSED",
          parent: {
            id: "I_parent",
            number: 540,
            title: "DU - Release 1.47",
          },
        },
        fieldValues: { nodes: [] },
      },
    ]);
    expect(items[0]?.parentIssueContentId).toBe("I_parent");
    expect(items[0]?.parentIssueTitle).toBe("DU - Release 1.47");
    expect(items[0]?.parentIssueNumber).toBe(540);
  });

  it("normalize renames synthetic parent-* with parentIssueTitle", () => {
    const flat: ProjectItem[] = [
      {
        nodeId: "PVTI_c",
        contentNodeId: "I_child",
        number: 525,
        title: "DU - IDM - Inconveniente con el Cluster",
        state: "CLOSED",
        url: null,
        contentType: "Issue",
        fieldValues: { Task: ["parent-ABOigBOw"] },
        parentTaskId: "parent-ABOigBOw",
        parentIssueContentId: "I_kwDOH5sqys8AAAABOigBOw",
        parentIssueTitle: "DU - Release 1.47",
        parentIssueNumber: 540,
        assignees: [],
      },
    ];
    const doc = normalizeProjectHierarchy({
      ...baseDoc(),
      items: flat,
      generalTasks: [
        {
          id: "parent-ABOigBOw",
          title: "parent-ABOigBOw",
          githubProjectItemNodeId: null,
          githubContentNodeId: "I_kwDOH5sqys8AAAABOigBOw",
          issueNumber: null,
          url: null,
        },
      ],
    });
    expect(doc.generalTasks).toHaveLength(1);
    expect(doc.generalTasks[0]?.id).toBe("DU - Release 1.47");
    expect(doc.generalTasks[0]?.title).toBe("DU - Release 1.47");
    expect(doc.generalTasks[0]?.issueNumber).toBe(540);
    expect(doc.items[0]?.parentTaskId).toBe("DU - Release 1.47");
    expect(doc.items[0]?.fieldValues.Task).toEqual(["DU - Release 1.47"]);
    expect(doc.generalTasks.some((g) => /^parent-/i.test(g.id))).toBe(false);
  });

  it("normalize drops synthetic when real parent root already exists", () => {
    const flat: ProjectItem[] = [
      {
        nodeId: "PVTI_c",
        contentNodeId: "I_child",
        number: 525,
        title: "child",
        state: "OPEN",
        url: null,
        contentType: "Issue",
        fieldValues: { Task: ["parent-ABOigBOw"] },
        parentTaskId: "parent-ABOigBOw",
        parentIssueContentId: "I_parent",
        parentIssueTitle: "DU - Release 1.47",
        parentIssueNumber: 540,
        assignees: [],
      },
    ];
    const doc = normalizeProjectHierarchy({
      ...baseDoc(),
      items: flat,
      generalTasks: [
        {
          id: "parent-ABOigBOw",
          title: "parent-ABOigBOw",
          githubProjectItemNodeId: null,
          githubContentNodeId: "I_parent",
          issueNumber: null,
          url: null,
        },
        {
          id: "DU - Release 1.47",
          title: "DU - Release 1.47",
          githubProjectItemNodeId: "PVTI_real",
          githubContentNodeId: "I_parent",
          issueNumber: 540,
          url: "https://github.com/rakkau/telecom-digitaluser/issues/540",
        },
      ],
    });
    expect(doc.generalTasks).toHaveLength(1);
    expect(doc.generalTasks[0]?.id).toBe("DU - Release 1.47");
    expect(doc.generalTasks[0]?.issueNumber).toBe(540);
    expect(doc.items[0]?.parentTaskId).toBe("DU - Release 1.47");
  });
});
