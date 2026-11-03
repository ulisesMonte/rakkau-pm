import type {
  GeneralTask,
  IssueLabel,
  ProjectDocument,
  ProjectItem,
} from "@/lib/types";
import { githubProjectStatusClosed } from "@/lib/taskStatus";
import {
  progressForContentNode,
  type GeneralTaskProgress,
} from "@/lib/taskProgress";

export type ProgressScope = "active" | "all";

export type StatBucket = {
  key: string;
  label: string;
  count: number;
};

export type FocusParent = {
  id: string;
  title: string;
  issueNumber?: number | null;
  status?: string;
  progress: GeneralTaskProgress;
};

export type ProjectProgressStats = {
  scope: ProgressScope;
  /** Filas del board consideradas en este scope. */
  totalInScope: number;
  /** Status Done / Closed en todo el board (histórico). */
  doneHistoric: number;
  /** Filas board totales (raíces + items). */
  boardTotal: number;
  /** Activos en todo el board (Status ≠ Done). */
  activeTotal: number;
  /**
   * Rollup de padres con sub-issues (summary o hijos en board).
   * Es el “avance del proyecto” útil cuando hay muchísimo Done histórico.
   */
  subIssuesRollup: GeneralTaskProgress;
  /** Padres que aportan al rollup. */
  parentsWithSubIssues: number;
  byStatus: StatBucket[];
  byIssueType: StatBucket[];
  byKindLabel: StatBucket[];
  /** Labels `scope/*` (p. ej. scope/am). Una fila puede aportar varios. */
  byScopeLabel: StatBucket[];
  byAssignee: StatBucket[];
  /** Padres activos con progreso, peor % primero. */
  focus: FocusParent[];
};

type BoardRow = {
  kind: "task" | "item";
  status?: string;
  state?: string;
  issueType?: string | null;
  labels: IssueLabel[];
  assignees: string[];
  title: string;
  id: string;
  issueNumber?: number | null;
  contentNodeId?: string | null;
  subIssuesSummary?: GeneralTask["subIssuesSummary"];
};

function rowIsDone(status?: string, state?: string): boolean {
  if (typeof status === "string" && status.trim()) {
    return githubProjectStatusClosed(status);
  }
  return String(state ?? "").toUpperCase() === "CLOSED";
}

function flattenBoard(project: ProjectDocument): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const t of project.generalTasks) {
    rows.push({
      kind: "task",
      status: t.Status,
      issueType: t.issueType?.name ?? null,
      labels: t.labels ?? [],
      assignees: t.assignees ?? [],
      title: t.title,
      id: t.id,
      issueNumber: t.issueNumber,
      contentNodeId: t.githubContentNodeId,
      subIssuesSummary: t.subIssuesSummary,
    });
  }
  for (const i of project.items) {
    rows.push({
      kind: "item",
      status:
        typeof i.fieldValues.Status === "string"
          ? i.fieldValues.Status
          : undefined,
      state: i.state,
      issueType: i.issueType?.name ?? null,
      labels: i.labels ?? [],
      assignees: i.assignees ?? [],
      title: i.title,
      id: i.nodeId,
      issueNumber: i.number,
      contentNodeId: i.contentNodeId,
      subIssuesSummary: i.subIssuesSummary,
    });
  }
  return rows;
}

function bucketize(
  entries: Array<string | null | undefined>,
  emptyLabel = "(sin valor)",
  limit = 8,
): StatBucket[] {
  const map = new Map<string, number>();
  for (const raw of entries) {
    const label = (raw ?? "").trim() || emptyLabel;
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
    .slice(0, limit);
}

function kindLabelName(labels: IssueLabel[]): string | null {
  const kind = labels.find((l) => /^kind\//i.test(l.name));
  if (kind) return kind.name;
  // fallbacks comunes
  const loose = labels.find((l) =>
    /^(bug|enhancement|documentation|feature)$/i.test(l.name),
  );
  return loose?.name ?? null;
}

function scopeLabelNames(labels: IssueLabel[]): string[] {
  return labels
    .map((l) => l.name.trim())
    .filter((n) => /^scope\//i.test(n));
}

function parentProgress(
  row: BoardRow,
  items: ProjectItem[],
): GeneralTaskProgress {
  return progressForContentNode(
    row.contentNodeId,
    items,
    row.subIssuesSummary,
  );
}

/**
 * Estadísticas de progreso del Project a partir del JSON local (post-Traer).
 * Default `active`: excluye Done para no inflar el % con histórico.
 */
export function computeProjectProgressStats(
  project: ProjectDocument,
  scope: ProgressScope = "active",
): ProjectProgressStats {
  const all = flattenBoard(project);
  const boardTotal = all.length;
  const doneHistoric = all.filter((r) => rowIsDone(r.status, r.state)).length;
  const activeTotal = boardTotal - doneHistoric;

  const inScope =
    scope === "all" ? all : all.filter((r) => !rowIsDone(r.status, r.state));

  // Padres = raíces GT + items mid-level que tienen summary o hijos en board.
  const parentCandidates: BoardRow[] = [];
  for (const r of all) {
    if (r.kind === "task") parentCandidates.push(r);
    else if (
      (r.subIssuesSummary && r.subIssuesSummary.total > 0) ||
      (r.contentNodeId &&
        project.items.some((i) => i.parentIssueContentId === r.contentNodeId))
    ) {
      parentCandidates.push(r);
    }
  }

  const parentsForRollup =
    scope === "all"
      ? parentCandidates
      : parentCandidates.filter((r) => !rowIsDone(r.status, r.state));

  let rollDone = 0;
  let rollTotal = 0;
  let parentsWithSubIssues = 0;
  const focus: FocusParent[] = [];

  for (const p of parentsForRollup) {
    const progress = parentProgress(p, project.items);
    if (progress.total <= 0 || progress.percent == null) continue;
    parentsWithSubIssues += 1;
    rollDone += progress.done;
    rollTotal += progress.total;
    focus.push({
      id: p.id,
      title: p.title,
      issueNumber: p.issueNumber,
      status: p.status,
      progress,
    });
  }

  focus.sort((a, b) => {
    const pa = a.progress.percent ?? 0;
    const pb = b.progress.percent ?? 0;
    if (pa !== pb) return pa - pb;
    // A igual %, priorizar más trabajo pendiente / mayor total.
    if ((b.progress.open ?? 0) !== (a.progress.open ?? 0)) {
      return (b.progress.open ?? 0) - (a.progress.open ?? 0);
    }
    return (b.progress.total ?? 0) - (a.progress.total ?? 0);
  });

  const subIssuesRollup: GeneralTaskProgress =
    rollTotal === 0
      ? { total: 0, done: 0, open: 0, percent: null }
      : {
          total: rollTotal,
          done: rollDone,
          open: rollTotal - rollDone,
          percent: Math.round((rollDone / rollTotal) * 100),
        };

  return {
    scope,
    totalInScope: inScope.length,
    doneHistoric,
    boardTotal,
    activeTotal,
    subIssuesRollup,
    parentsWithSubIssues,
    byStatus: bucketize(
      inScope.map((r) => r.status),
      "(sin Status)",
    ),
    byIssueType: bucketize(
      inScope.map((r) => r.issueType),
      "(sin tipo)",
    ),
    byKindLabel: bucketize(
      inScope.map((r) => kindLabelName(r.labels)),
      "(sin kind)",
    ),
    byScopeLabel: bucketize(
      inScope.flatMap((r) => {
        const scopes = scopeLabelNames(r.labels);
        return scopes.length ? scopes : ["(sin scope)"];
      }),
      "(sin scope)",
      10,
    ),
    byAssignee: bucketize(
      inScope.flatMap((r) => (r.assignees.length ? r.assignees : ["(sin asignar)"])),
      "(sin asignar)",
      6,
    ),
    focus: focus.slice(0, 6),
  };
}
