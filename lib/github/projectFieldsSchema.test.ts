import { describe, expect, it } from "vitest";
import type { ProjectField } from "@/lib/types";
import {
  annotateProjectField,
  buildFieldBindings,
  canonicalKeyForFieldName,
  diffFieldCatalog,
  mapGitHubProjectFields,
  mergeGitHubFieldCatalog,
  PROJECT_FIELDS_SCHEMA_VERSION,
} from "./projectFieldsSchema";

describe("projectFieldsSchema", () => {
  it("maps GitHub nodes with canonicalKey", () => {
    const fields = mapGitHubProjectFields([
      { id: "PVTF_x", name: "Blocked", dataType: "SINGLE_SELECT", options: [] },
      { id: "PVTF_y", name: "Track / Journey", dataType: "SINGLE_SELECT" },
    ]);
    expect(fields).toHaveLength(2);
    expect(fields[0].canonicalKey).toBe("Blocked");
    expect(fields[0].origin).toBe("github");
    expect(fields[1].canonicalKey).toBeUndefined();
  });

  it("builds bindings for canonical columns only", () => {
    const fields: ProjectField[] = [
      annotateProjectField({
        id: "1",
        name: "Sprint",
        dataType: "TEXT",
        pendingCreate: false,
      }),
      annotateProjectField({
        id: "local",
        name: "Custom",
        dataType: "TEXT",
        pendingCreate: true,
      }),
    ];
    const bindings = buildFieldBindings(fields);
    expect(bindings).toEqual([
      {
        canonicalKey: "Sprint",
        githubFieldId: "1",
        githubFieldName: "Sprint",
        dataType: "TEXT",
      },
    ]);
  });

  it("diff detects id_replaced on same column name", () => {
    const before: ProjectField[] = [
      { id: "old", name: "Sprint", dataType: "TEXT" },
    ];
    const after: ProjectField[] = [
      annotateProjectField({ id: "new", name: "Sprint", dataType: "TEXT" }),
    ];
    const plan = diffFieldCatalog(before, after);
    expect(plan.schemaVersion).toBe(PROJECT_FIELDS_SCHEMA_VERSION);
    expect(plan.changes.some((c) => c.kind === "id_replaced")).toBe(true);
  });

  it("merge prefers remote ids by name", () => {
    const local: ProjectField[] = [
      { id: "local_sprint", name: "Sprint", dataType: "TEXT", pendingCreate: true },
    ];
    const remote: ProjectField[] = [
      { id: "gh_sprint", name: "Sprint", dataType: "TEXT" },
    ];
    const merged = mergeGitHubFieldCatalog(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("gh_sprint");
    expect(merged[0].pendingCreate).toBeFalsy();
  });

  it("canonicalKeyForFieldName", () => {
    expect(canonicalKeyForFieldName("DueDate")).toBe("DueDate");
    expect(canonicalKeyForFieldName("Responsable")).toBe("Responsable");
    expect(canonicalKeyForFieldName("EstadoOperativo")).toBe("EstadoOperativo");
    expect(canonicalKeyForFieldName("Status")).toBeUndefined();
  });
});
