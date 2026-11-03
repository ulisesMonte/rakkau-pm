import { describe, expect, it } from "vitest";
import { issueTypeToneClass } from "@/lib/issueMeta";

describe("issueTypeToneClass", () => {
  it("mapea Task / Bug / Feature", () => {
    expect(issueTypeToneClass("Task")).toBe("rk-type-task");
    expect(issueTypeToneClass("Bug")).toBe("rk-type-bug");
    expect(issueTypeToneClass("Feature")).toBe("rk-type-feature");
    expect(issueTypeToneClass("Other")).toBe("rk-type-other");
  });
});
