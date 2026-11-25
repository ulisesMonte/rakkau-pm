import { describe, expect, it } from "vitest";
import {
  jiraBrowseUrlWithBase,
  parseAllJiraKeysFromText,
  parseJiraKeyFromText,
} from "@/lib/jiraKey";

describe("parseJiraKeyFromText", () => {
  it("parses bare PROJ-123", () => {
    expect(parseJiraKeyFromText("See CIAM-42 for details")).toBe("CIAM-42");
  });

  it("prefers ID JIRA labeled line", () => {
    expect(
      parseJiraKeyFromText("Title stuff\nID JIRA: TECO-99\nOther CIAM-1"),
    ).toBe("TECO-99");
  });

  it("parses browse URL", () => {
    expect(
      parseJiraKeyFromText(
        "https://acme.atlassian.net/browse/ABC-7 linked here",
      ),
    ).toBe("ABC-7");
  });

  it("returns null when absent", () => {
    expect(parseJiraKeyFromText("no ticket here")).toBeNull();
    expect(parseJiraKeyFromText("")).toBeNull();
    expect(parseJiraKeyFromText(null)).toBeNull();
  });

  it("skips CVE-like noise", () => {
    expect(parseJiraKeyFromText("CVE-2024-1234 and CIAM-8")).toBe("CIAM-8");
  });
});

describe("parseAllJiraKeysFromText", () => {
  it("collects distinct keys", () => {
    expect(parseAllJiraKeysFromText("CIAM-1 and TECO-2 and CIAM-1")).toEqual([
      "CIAM-1",
      "TECO-2",
    ]);
  });
});

describe("jiraBrowseUrlWithBase", () => {
  it("builds browse URL", () => {
    expect(
      jiraBrowseUrlWithBase("ciam-9", "https://acme.atlassian.net/"),
    ).toBe("https://acme.atlassian.net/browse/CIAM-9");
  });

  it("returns null without base or key", () => {
    expect(jiraBrowseUrlWithBase("CIAM-1", "")).toBeNull();
    expect(jiraBrowseUrlWithBase("", "https://x")).toBeNull();
  });
});
