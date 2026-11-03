import type {
  GeneralTask,
  ProjectItem,
  SubIssuesSummary,
} from "@/lib/types";
import { githubProjectStatusClosed } from "@/lib/taskStatus";
import { resolveItemParentTaskId } from "@/lib/taskParent";

export type GeneralTaskProgress = {
  total: number;
  done: number;
  open: number;
  /** 0–100; null si no hay subtareas. */
  percent: number | null;
};

function subtaskIsDone(item: ProjectItem): boolean {
  const status = item.fieldValues.Status;
  if (typeof status === "string" && status.trim()) {
    return githubProjectStatusClosed(status);
  }
  const state = String(item.state ?? "").toUpperCase();
  return state === "CLOSED";
}

function fromSummary(summary: SubIssuesSummary): GeneralTaskProgress {
  const total = summary.total;
  const done = summary.completed;
  return {
    total,
    done,
    open: Math.max(0, total - done),
    percent: total === 0 ? null : Math.round(summary.percentCompleted),
  };
}

function fromChildren(children: ProjectItem[]): GeneralTaskProgress {
  const total = children.length;
  if (total === 0) {
    return { total: 0, done: 0, open: 0, percent: null };
  }
  const done = children.filter(subtaskIsDone).length;
  return {
    total,
    done,
    open: total - done,
    percent: Math.round((done / total) * 100),
  };
}

/** Hijos inmediatos por arista GitHub parentIssueContentId. */
export function directChildrenByContentId(
  parentContentId: string | null | undefined,
  items: ProjectItem[],
): ProjectItem[] {
  if (!parentContentId) return [];
  return items.filter((i) => i.parentIssueContentId === parentContentId);
}

/**
 * % de avance estilo GitHub Sub-issues: hijos inmediatos.
 * Prefiere `subIssuesSummary` del API cuando existe.
 */
export function progressForContentNode(
  contentNodeId: string | null | undefined,
  items: ProjectItem[],
  summary?: SubIssuesSummary | null,
): GeneralTaskProgress {
  if (summary && summary.total > 0) {
    return fromSummary(summary);
  }
  return fromChildren(directChildrenByContentId(contentNodeId, items));
}

/** % de avance de una tarea general = subtareas cerradas / total (legacy 1 nivel). */
export function generalTaskProgress(
  taskId: string,
  items: ProjectItem[],
): GeneralTaskProgress {
  const children = items.filter((i) => resolveItemParentTaskId(i) === taskId);
  return fromChildren(children);
}

export function formatProgressPercent(p: GeneralTaskProgress): string {
  if (p.percent == null) return "—";
  return `${p.percent}%`;
}

/** Fracción estilo GitHub: `3 / 12 · 25%`. */
export function formatProgressFraction(p: GeneralTaskProgress): string {
  if (p.percent == null || p.total === 0) return "—";
  return `${p.done} / ${p.total} · ${p.percent}%`;
}

/** Atajo tipado para filas que ya tienen el GeneralTask. */
export function progressForGeneralTask(
  task: GeneralTask,
  items: ProjectItem[],
): GeneralTaskProgress {
  if (task.githubContentNodeId) {
    return progressForContentNode(
      task.githubContentNodeId,
      items,
      task.subIssuesSummary,
    );
  }
  return generalTaskProgress(task.id, items);
}

/** Avance de un ítem intermedio (padre de otros ítems). */
export function progressForProjectItem(
  item: ProjectItem,
  items: ProjectItem[],
): GeneralTaskProgress {
  return progressForContentNode(
    item.contentNodeId,
    items,
    item.subIssuesSummary,
  );
}
