import type { ProjectDocument, ProjectItem } from "@/lib/types";
import { CANONICAL_FIELDS } from "@/lib/types";

/** Tarea padre de un ítem: `parentTaskId` local o columna Task de GitHub. */
export function resolveItemParentTaskId(item: ProjectItem): string | null {
  const direct = item.parentTaskId?.trim();
  if (direct) return direct;
  const t = item.fieldValues.Task;
  if (Array.isArray(t)) {
    const first = t[0]?.trim();
    return first || null;
  }
  if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}

/** IDs elegibles como padre al crear subtareas (orden: generalTasks, luego refs en ítems). */
export function parentTaskOptions(project: ProjectDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of project.generalTasks) {
    if (!seen.has(t.id)) {
      out.push(t.id);
      seen.add(t.id);
    }
  }
  for (const item of project.items) {
    const pid = resolveItemParentTaskId(item);
    if (pid && !seen.has(pid)) {
      out.push(pid);
      seen.add(pid);
    }
  }
  return out;
}

export function taskFieldValueForParent(
  project: ProjectDocument,
  parentTaskId: string,
): string | string[] {
  const taskField = project.fields.find((f) => f.name === CANONICAL_FIELDS.Task);
  if (taskField?.dataType === "SINGLE_SELECT") return parentTaskId;
  return [parentTaskId];
}
