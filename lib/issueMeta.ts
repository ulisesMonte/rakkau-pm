import type { CSSProperties } from "react";
import type { IssueLabel, IssueTypeRef, ProjectDocument } from "@/lib/types";

/** Clase CSS según nombre de Issue Type (colores estilo GitHub). */
export function issueTypeToneClass(name?: string | null): string {
  const n = (name ?? "").trim().toLowerCase();
  if (n === "bug") return "rk-type-bug";
  if (n === "feature") return "rk-type-feature";
  if (n === "task") return "rk-type-task";
  return "rk-type-other";
}

/** Estilo inline si GitHub manda color hex / nombre. */
export function issueTypeStyle(
  issueType?: IssueTypeRef | null,
): CSSProperties | undefined {
  const raw = issueType?.color?.trim();
  if (!raw) return undefined;
  // Labels API: hex sin #. IssueType a veces "BLUE"/"RED"/hex.
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return {
      borderColor: `#${raw}`,
      color: `#${raw}`,
      background: `#${raw}22`,
    };
  }
  const named: Record<string, string> = {
    BLUE: "#58a6ff",
    GREEN: "#3fb950",
    YELLOW: "#d29922",
    ORANGE: "#db6d28",
    RED: "#f85149",
    PINK: "#db61a2",
    PURPLE: "#a371f7",
    GRAY: "#8b949e",
  };
  const hex = named[raw.toUpperCase()];
  if (!hex) return undefined;
  return {
    borderColor: hex,
    color: hex,
    background: `${hex}22`,
  };
}

export function labelChipStyle(label: IssueLabel): CSSProperties {
  const hex = label.color?.replace(/^#/, "");
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {};
  }
  return {
    background: `#${hex}33`,
    borderColor: `#${hex}88`,
    color: `#${hex}`,
  };
}

export function collectProjectLabels(project: ProjectDocument): string[] {
  const set = new Set<string>();
  for (const t of project.generalTasks) {
    for (const l of t.labels ?? []) if (l.name) set.add(l.name);
  }
  for (const i of project.items) {
    for (const l of i.labels ?? []) if (l.name) set.add(l.name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Solo labels `scope/*` del Project (filtro Scope). */
export function collectProjectScopes(project: ProjectDocument): string[] {
  return collectProjectLabels(project).filter((n) => /^scope\//i.test(n));
}

export function collectProjectIssueTypes(project: ProjectDocument): string[] {
  const set = new Set<string>();
  for (const t of project.generalTasks) {
    const n = t.issueType?.name?.trim();
    if (n) set.add(n);
  }
  for (const i of project.items) {
    const n = i.issueType?.name?.trim();
    if (n) set.add(n);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}
