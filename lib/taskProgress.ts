import type { GeneralTask, ProjectItem } from "@/lib/types";
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

/** % de avance de una tarea general = subtareas cerradas / total. */
export function generalTaskProgress(
  taskId: string,
  items: ProjectItem[],
): GeneralTaskProgress {
  const children = items.filter((i) => resolveItemParentTaskId(i) === taskId);
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

export function formatProgressPercent(p: GeneralTaskProgress): string {
  if (p.percent == null) return "—";
  return `${p.percent}%`;
}

/** Atajo tipado para filas que ya tienen el GeneralTask. */
export function progressForGeneralTask(
  task: GeneralTask,
  items: ProjectItem[],
): GeneralTaskProgress {
  return generalTaskProgress(task.id, items);
}
