import type { GeneralTask, ProjectDocument, ProjectField, ProjectItem } from "@/lib/types";
import { CANONICAL_FIELDS } from "@/lib/types";

/** Columnas nativas de GitHub ya representadas con UX fija en la tabla. */
export const PINNED_GITHUB_FIELD_NAMES = new Set([
  "Title",
  "Status",
  "Assignees",
]);

/**
 * Canónicos que no van como columna: el ID Task ya se muestra en el nombre
 * de la tarea general / jerarquía.
 */
const HIDDEN_TABLE_FIELD_NAMES = new Set<string>([
  CANONICAL_FIELDS.Task,
  /** Se muestra en la columna Estado de la tarea general. */
  CANONICAL_FIELDS.EstadoOperativo,
  /** Redundante: el Status GitHub «Bloqueado» ya indica bloqueo. */
  CANONICAL_FIELDS.Blocked,
  CANONICAL_FIELDS.BlockedReason,
]);

/** Campos de sistema que no se muestran como columnas de tabla. */
const SKIP_TABLE_DATA_TYPES = new Set<string>([
  "LABELS",
  "MILESTONE",
  "REPOSITORY",
  "TRACKED_BY",
  "TRACKS",
  "LINKED_PULL_REQUESTS",
  "REVIEWERS",
  "PARENT_ISSUE",
  "SUB_ISSUES_PROGRESS",
  "CREATED",
  "UPDATED",
  "CLOSED",
]);

const EDITABLE_DATA_TYPES = new Set<string>([
  "TEXT",
  "NUMBER",
  "DATE",
  "SINGLE_SELECT",
]);

/** No editar Sí/No en panel; bloqueo vía Status «Bloqueado» + motivo. */
const EDIT_PANEL_SKIP_FIELD_NAMES = new Set<string>([
  CANONICAL_FIELDS.Blocked,
  CANONICAL_FIELDS.BlockedReason,
]);

/**
 * Columnas de tabla = campos del Project v2 en GitHub (mismo orden que `project.fields`).
 * Excluye Title, Status y Assignees (columnas fijas Rakkau).
 */
export function githubTableColumns(project: ProjectDocument): ProjectField[] {
  return project.fields.filter(
    (f) =>
      !PINNED_GITHUB_FIELD_NAMES.has(f.name) &&
      !HIDDEN_TABLE_FIELD_NAMES.has(f.name) &&
      !SKIP_TABLE_DATA_TYPES.has(f.dataType),
  );
}

/** Campos con editor fijo arriba en EditPanel — no repetir en «Campos del proyecto». */
const EDIT_PANEL_DEDICATED_CANONICAL = new Set<string>(
  Object.values(CANONICAL_FIELDS),
);

/** Solo columnas custom + no duplicar canónicos ya editables arriba en el panel. */
export function githubEditPanelCustomColumns(
  project: ProjectDocument,
): ProjectField[] {
  return githubEditableColumns(project).filter(
    (f) => !EDIT_PANEL_DEDICATED_CANONICAL.has(f.name),
  );
}

/** Campos editables en panel / push (los de GitHub que aceptan mutación). */
export function githubEditableColumns(project: ProjectDocument): ProjectField[] {
  return githubTableColumns(project).filter(
    (f) =>
      EDITABLE_DATA_TYPES.has(f.dataType) &&
      !EDIT_PANEL_SKIP_FIELD_NAMES.has(f.name),
  );
}

/** Valor de celda desde ítem o tarea general (JSON local). */
export function columnFieldValue(
  field: ProjectField,
  ctx: { item?: ProjectItem | null; task?: GeneralTask | null },
): string | string[] | undefined {
  if (ctx.item) {
    return ctx.item.fieldValues[field.name];
  }
  const task = ctx.task;
  if (!task) return undefined;
  switch (field.name) {
    case CANONICAL_FIELDS.Task:
      return task.id;
    case CANONICAL_FIELDS.Blocked:
      return task.Blocked;
    case CANONICAL_FIELDS.BlockedReason:
      return task.BlockedReason;
    case CANONICAL_FIELDS.HasDependency:
      return task.HasDependency;
    case CANONICAL_FIELDS.DependsOn:
      return task.DependsOn;
    case CANONICAL_FIELDS.Sprint:
      return task.Sprint;
    case CANONICAL_FIELDS.Quarter:
      return task.Quarter;
    case CANONICAL_FIELDS.DueDate:
      return task.DueDate;
    case CANONICAL_FIELDS.Responsable:
      return task.Responsable;
    case CANONICAL_FIELDS.EstadoOperativo:
      return task.EstadoOperativo;
    default:
      return task.githubFieldValues?.[field.name];
  }
}
