import type { GeneralTask, ItemFieldValues } from "@/lib/types";
import { CANONICAL_FIELDS } from "@/lib/types";
import { asStringList } from "@/lib/fieldValueCoerce";
import { titleMarksDependency } from "@/lib/dependencyTitle";
import { normalizeResponsableValue } from "@/lib/responsable";

const RESERVED_EXTRA_KEYS = new Set<string>([
  ...Object.values(CANONICAL_FIELDS),
  "Title",
  "Status",
  "Assignees",
  "_body",
]);

/** Copia fieldValues de fila GitHub → GeneralTask (canónicos + githubFieldValues). */
export function applyItemFieldValuesToGeneralTask(
  gt: GeneralTask,
  fv: ItemFieldValues,
): GeneralTask {
  const next: GeneralTask = { ...gt };

  if (typeof fv.Status === "string" && fv.Status.trim()) {
    next.Status = fv.Status.trim();
  }
  if (typeof fv.HasDependency === "string") next.HasDependency = fv.HasDependency;
  if (typeof fv.DependsOn === "string") next.DependsOn = fv.DependsOn;
  if (typeof fv.Blocked === "string") next.Blocked = fv.Blocked;
  if (typeof fv.BlockedReason === "string") next.BlockedReason = fv.BlockedReason;
  if (typeof fv.Sprint === "string") next.Sprint = fv.Sprint;
  if (typeof fv.Quarter === "string") next.Quarter = fv.Quarter;
  if (typeof fv.DueDate === "string") next.DueDate = fv.DueDate;
  if (typeof fv.Responsable === "string") {
    next.Responsable = normalizeResponsableValue(fv.Responsable);
  }
  if (titleMarksDependency(next.title)) {
    next.isDependency = true;
    if (next.HasDependency !== "Sí") next.HasDependency = "Sí";
  }
  if (typeof fv.EstadoOperativo === "string") {
    next.EstadoOperativo = fv.EstadoOperativo as GeneralTask["EstadoOperativo"];
  }

  const assignees = asStringList(fv.Assignees);
  if (assignees.length) next.assignees = assignees;

  const extra = { ...(next.githubFieldValues ?? {}) };
  for (const [key, val] of Object.entries(fv)) {
    if (RESERVED_EXTRA_KEYS.has(key) || val === undefined) continue;
    extra[key] = val;
  }
  next.githubFieldValues = extra;

  return next;
}

export function mergeGeneralTaskGithubFieldValues(
  remote: GeneralTask,
  local: GeneralTask,
): ItemFieldValues | undefined {
  const r = remote.githubFieldValues ?? {};
  const l = local.githubFieldValues ?? {};
  const keys = new Set([...Object.keys(r), ...Object.keys(l)]);
  if (!keys.size) return undefined;
  const merged: ItemFieldValues = { ...r };
  for (const key of keys) {
    if (key in l) merged[key] = l[key];
  }
  return merged;
}
