import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@/lib/types";
import {
  inferRepositoriesFromDocument,
  pickDefaultIssueRepository,
  uniqueRepositorySlugs,
} from "@/lib/github/issueHierarchy";

function bareDoc(partial: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    projectId: "PVT_test",
    number: 1,
    title: "Test",
    owner: "ulisesMonte",
    pulledAt: null,
    dirty: false,
    fields: [],
    generalTasks: [],
    items: [],
    links: { blockedBy: {}, blocks: {} },
    ...partial,
  };
}

describe("uniqueRepositorySlugs", () => {
  it("dedupea case-insensitive y ignora basura", () => {
    expect(
      uniqueRepositorySlugs(
        "ulisesMonte/ciam-ops-hybrid-test",
        ["UlisesMonte/ciam-ops-hybrid-test", "other/repo", "", null, "nope"],
      ),
    ).toEqual(["ulisesMonte/ciam-ops-hybrid-test", "other/repo"]);
  });
});

describe("inferRepositoriesFromDocument", () => {
  it("extrae owner/repo desde URLs de items y generalTasks", () => {
    const doc = bareDoc({
      items: [
        {
          nodeId: "1",
          number: 1,
          title: "a",
          state: "OPEN",
          url: "https://github.com/ulisesMonte/ciam-ops-hybrid-test/issues/1",
          contentType: "Issue",
          fieldValues: {},
          parentTaskId: null,
          assignees: [],
        },
      ],
      generalTasks: [
        {
          id: "T1",
          title: "padre",
          url: "https://github.com/acme/other/issues/9",
        },
      ],
    });
    expect(inferRepositoriesFromDocument(doc)).toEqual([
      "ulisesMonte/ciam-ops-hybrid-test",
      "acme/other",
    ]);
  });
});

describe("pickDefaultIssueRepository", () => {
  it("prioriza preferred sobre available y env", () => {
    expect(
      pickDefaultIssueRepository({
        preferred: "user/chosen",
        available: ["a/b", "c/d"],
      }),
    ).toBe("user/chosen");
  });

  it("usa available cuando no hay preferred ni env", () => {
    const prev = process.env.GH_ISSUE_REPOSITORY;
    delete process.env.GH_ISSUE_REPOSITORY;
    try {
      expect(
        pickDefaultIssueRepository({
          preferred: null,
          available: ["a/b", "c/d"],
        }),
      ).toBe("a/b");
    } finally {
      if (prev === undefined) delete process.env.GH_ISSUE_REPOSITORY;
      else process.env.GH_ISSUE_REPOSITORY = prev;
    }
  });

  it("cae a URLs del documento si no hay preferred/available/env", () => {
    const prev = process.env.GH_ISSUE_REPOSITORY;
    delete process.env.GH_ISSUE_REPOSITORY;
    try {
      const doc = bareDoc({
        items: [
          {
            nodeId: "1",
            number: 2,
            title: "x",
            state: "OPEN",
            url: "https://github.com/from/url/issues/2",
            contentType: "Issue",
            fieldValues: {},
            parentTaskId: null,
            assignees: [],
          },
        ],
      });
      expect(pickDefaultIssueRepository({ doc })).toBe("from/url");
    } finally {
      if (prev === undefined) delete process.env.GH_ISSUE_REPOSITORY;
      else process.env.GH_ISSUE_REPOSITORY = prev;
    }
  });
});
