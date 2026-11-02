"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { FieldDataType, GeneralTask, ProjectDocument, ProjectField, ProjectItem } from "@/lib/types";
import { CANONICAL_FIELDS } from "@/lib/types";
import {
  generalTaskMatches,
  isQueryEmpty,
  subtaskMatches,
  type TaskFilterQuery,
} from "@/lib/taskFilters";
import { itemDisplayTitle } from "@/lib/itemTitle";
import {
  isActiveTaskStatus,
  issueStateFromProjectStatus,
  taskStatusDisplay,
} from "@/lib/taskStatus";
import {
  parentTaskOptions,
  resolveItemParentTaskId,
} from "@/lib/taskParent";
import {
  columnFieldValue,
  githubEditableColumns,
  githubTableColumns,
} from "@/lib/githubTableColumns";
import { RakkauConfirmDialog } from "./RakkauConfirmDialog";
import { RakkauNotice } from "./RakkauNotice";

interface HierarchyTableProps {
  project: ProjectDocument;
  onChangeItem: (
    nodeId: string,
    patch: Partial<ProjectItem["fieldValues"]>,
  ) => void;
  onPatchItem: (nodeId: string, patch: Partial<ProjectItem>) => void;
  onPatchGeneralTask: (id: string, patch: Partial<GeneralTask>) => void;
  onAddGeneralTask: (id: string, title: string) => void;
  onAddSubtask: (title: string, parentTaskId: string) => void;
  onAddField: (field: ProjectField) => void | Promise<void>;
  onDeleteItem: (nodeId: string) => void | Promise<void>;
  onDeleteGeneralTask: (id: string) => void;
}

interface Group {
  task: GeneralTask;
  children: ProjectItem[];
  contextOnly?: boolean;
}

type PanelTarget =
  | { kind: "task"; id: string }
  | { kind: "item"; nodeId: string };

type DeleteConfirm =
  | { kind: "item"; nodeId: string; title: string }
  | { kind: "task"; id: string; label: string };

// 3 columnas fijas (título, estado, asignado) + campos GH + acciones
const CORE_TABLE_COLS = 3;

function totalCols(ghColumns: ProjectField[]): number {
  return CORE_TABLE_COLS + ghColumns.length + 1;
}

const CANONICAL_NAMES = new Set<string>([
  ...Object.values(CANONICAL_FIELDS),
  "Assignees",
  "Status",
  "Title",
]);

// ─── helpers ────────────────────────────────────────────────────────────────

function buildGroups(project: ProjectDocument): {
  groups: Group[];
  orphans: ProjectItem[];
} {
  const byParent = new Map<string, ProjectItem[]>();
  const orphans: ProjectItem[] = [];
  for (const item of project.items) {
    const pid = resolveItemParentTaskId(item);
    if (!pid) { orphans.push(item); continue; }
    const list = byParent.get(pid) ?? [];
    list.push(item);
    byParent.set(pid, list);
  }
  const groups: Group[] = project.generalTasks.map((task) => ({
    task,
    children: byParent.get(task.id) ?? [],
  }));
  for (const [id, children] of byParent) {
    if (!project.generalTasks.some((t) => t.id === id)) {
      groups.push({ task: { id, title: id }, children });
    }
  }
  return { groups, orphans };
}

function taskOptions(project: ProjectDocument): string[] {
  const set = new Set(project.generalTasks.map((t) => t.id));
  for (const item of project.items) {
    const t = item.fieldValues.Task;
    if (Array.isArray(t)) t.forEach((x) => set.add(x));
    else if (typeof t === "string" && t) set.add(t);
  }
  return Array.from(set).sort();
}

function dependencyTargets(
  project: ProjectDocument,
  selfNodeId: string,
): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (const t of project.generalTasks) {
    out.push({ value: t.id, label: `Tarea · ${t.id}` });
  }
  for (const item of project.items) {
    if (item.nodeId === selfNodeId) continue;
    const tag = item.number != null ? `#${item.number}` : item.nodeId.slice(-6);
    out.push({
      value: item.number != null ? `#${item.number}` : item.nodeId,
      label: `Subtarea · ${tag} ${itemDisplayTitle(item)}`,
    });
  }
  return out;
}

function parseDeps(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── Custom field cell renderer ───────────────────────────────────────────────

function CustomFieldCell({ field, value }: { field: ProjectField; value: string | string[] | undefined }) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
    return <span className="rk-muted">—</span>;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (field.dataType === "SINGLE_SELECT") {
    const opt = field.options?.find((o) => o.name === raw);
    const color = opt?.color?.toLowerCase() ?? "gray";
    return (
      <span className={`rk-chip rk-chip-custom rk-chip-custom--${color}`}>{raw}</span>
    );
  }
  if (field.dataType === "DATE") {
    return <span className="rk-cell-text">{formatDue(raw)}</span>;
  }
  return <span className="rk-cell-text">{raw}</span>;
}

function GitHubFieldCell({
  field,
  item,
  task,
}: {
  field: ProjectField;
  item?: ProjectItem | null;
  task?: GeneralTask | null;
}) {
  const value = columnFieldValue(field, { item, task });
  if (field.name === CANONICAL_FIELDS.DependsOn) {
    const raw = typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : "";
    return <DepCell deps={parseDeps(raw)} />;
  }
  if (field.name === CANONICAL_FIELDS.Blocked) {
    const reason =
      (item?.fieldValues.BlockedReason ?? task?.BlockedReason ?? "") || undefined;
    const blocked =
      value === "Sí" ||
      taskIsBlocked({
        Blocked: typeof value === "string" ? value : undefined,
        Status: item?.fieldValues.Status,
      });
    return <BlockedCell blocked={blocked} reason={reason} />;
  }
  if (field.name === CANONICAL_FIELDS.BlockedReason) {
    return <span className="rk-cell-text">{dash(typeof value === "string" ? value : "")}</span>;
  }
  if (field.name === CANONICAL_FIELDS.DueDate) {
    const due = typeof value === "string" ? value : undefined;
    return <span className="rk-cell-text">{formatDue(due)}</span>;
  }
  if (field.name === CANONICAL_FIELDS.Task) {
    const raw = Array.isArray(value) ? value[0] : value;
    return <span className="rk-cell-text">{dash(typeof raw === "string" ? raw : "")}</span>;
  }
  return <CustomFieldCell field={field} value={value} />;
}

// ─── Add-field panel ──────────────────────────────────────────────────────────

const ADDABLE_TYPES: Array<{ value: FieldDataType; label: string }> = [
  { value: "TEXT", label: "Texto" },
  { value: "NUMBER", label: "Número" },
  { value: "DATE", label: "Fecha" },
  { value: "SINGLE_SELECT", label: "Opción única" },
];

function AddFieldPanel({
  onAdd,
  onClose,
}: {
  onAdd: (field: ProjectField) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState<FieldDataType>("TEXT");
  const [optionInput, setOptionInput] = useState("");
  const [options, setOptions] = useState<Array<{ name: string; color: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const COLORS = ["BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE", "GRAY"];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addOption() {
    const n = optionInput.trim();
    if (!n) return;
    if (options.some((o) => o.name.toLowerCase() === n.toLowerCase())) {
      setError("Esa opción ya existe."); return;
    }
    setOptions([...options, { name: n, color: COLORS[options.length % COLORS.length] }]);
    setOptionInput("");
    setError(null);
  }

  function removeOption(idx: number) {
    setOptions(options.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setError("El nombre es obligatorio."); return; }
    if (CANONICAL_NAMES.has(n)) { setError(`"${n}" es un campo estándar, usá otro nombre.`); return; }
    if (dataType === "SINGLE_SELECT" && !options.length) {
      setError("Agregá al menos una opción."); return;
    }
    const field: ProjectField = {
      id: `pending_${n.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`,
      name: n,
      dataType,
      options: dataType === "SINGLE_SELECT"
        ? options.map((o, i) => ({ id: `opt_${i}`, name: o.name, color: o.color }))
        : undefined,
      pendingCreate: true,
    };
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(field);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la columna");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rk-edit-overlay" role="presentation" onClick={onClose}>
      <aside
        className="rk-edit-panel rk-add-field-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Agregar columna personalizada"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rk-edit-panel-head">
          <div>
            <p className="rk-edit-kicker">Columna personalizada</p>
            <h3 className="rk-edit-title">Nueva columna</h3>
          </div>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose}>Cerrar</button>
        </header>

        <form className="rk-edit-panel-body" onSubmit={handleSubmit}>
          <label className="rk-label">Nombre del campo
            <input
              className="rk-input"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="ej. Impacto, Prioridad, Estimación…"
              autoFocus
            />
          </label>

          <label className="rk-label">Tipo
            <select
              className="rk-select-sm"
              value={dataType}
              onChange={(e) => { setDataType(e.target.value as FieldDataType); setOptions([]); }}
            >
              {ADDABLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          {dataType === "SINGLE_SELECT" && (
            <div className="rk-label">Opciones
              <div className="rk-option-builder">
                <div className="rk-option-input-row">
                  <input
                    className="rk-input rk-input-option"
                    value={optionInput}
                    onChange={(e) => setOptionInput(e.target.value)}
                    placeholder="Nombre de opción…"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                  />
                  <button type="button" className="rk-btn rk-btn-ghost rk-btn-sm" onClick={addOption}>
                    + Agregar
                  </button>
                </div>
                {options.length > 0 && (
                  <div className="rk-option-list">
                    {options.map((o, i) => (
                      <div key={i} className="rk-option-row">
                        <span className={`rk-chip rk-chip-custom rk-chip-custom--${o.color.toLowerCase()}`}>
                          {o.name}
                        </span>
                        <button
                          type="button"
                          className="rk-option-remove"
                          onClick={() => removeOption(i)}
                          aria-label={`Eliminar opción ${o.name}`}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <p className="rk-form-error">{error}</p>}

          <div className="rk-add-field-note">
            Con <strong>GH_TOKEN</strong> se crea el campo en GitHub al guardar.
            Sin token queda en JSON local hasta publicar.
            Solo aplica a este proyecto; las columnas estándar son comunes a todos.
          </div>

          <div className="rk-edit-panel-actions">
            <button type="submit" className="rk-btn rk-btn-primary" disabled={submitting}>
              {submitting ? "Creando…" : "Agregar columna"}
            </button>
            <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function sprintNames(project: ProjectDocument): string[] {
  const fromSprints = (project.sprints ?? []).map((s) => s.name);
  const fromItems = project.items
    .map((i) => i.fieldValues.Sprint)
    .filter((s): s is string => Boolean(s));
  return Array.from(new Set([...fromSprints, ...fromItems]));
}

function peopleLogins(project: ProjectDocument): string[] {
  const set = new Set<string>();
  if (project.owner) set.add(project.owner);
  for (const p of project.people ?? []) set.add(p.login);
  for (const item of project.items) for (const a of item.assignees ?? []) set.add(a);
  for (const t of project.generalTasks) for (const a of t.assignees ?? []) set.add(a);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function dueNearClass(due?: string, status?: string, issueState?: string): string {
  if (!due) return "";
  if (!isActiveTaskStatus(status, issueState)) return "";
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const d = new Date(`${due.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return (diff === 0 || diff === 1) ? " rk-row-due-soon" : "";
}

function dash(v?: string | null): string {
  return (v ?? "").trim() || "—";
}

function formatDue(due?: string): string {
  if (!due) return "—";
  const [y, m, d] = due.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : due.slice(0, 10);
}

function statusView(state?: string): { text: string; open: boolean } {
  return taskStatusDisplay(undefined, state);
}

/** Campo Status nativo de GitHub Projects (Todo / In Progress / Done). */
function githubStatusField(project: ProjectDocument): ProjectField | undefined {
  return project.fields.find(
    (f) => f.name === "Status" && f.dataType === "SINGLE_SELECT",
  );
}

function itemStatusDisplay(item: ProjectItem): { text: string; open: boolean } {
  return taskStatusDisplay(item.fieldValues.Status, item.state);
}

function generalTaskStatusDisplay(task: GeneralTask): { text: string; open: boolean } {
  return taskStatusDisplay(task.Status);
}

// ─── icons ──────────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M10 3l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8C1 8 3.5 3 8 3s7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

// ─── small cell components ───────────────────────────────────────────────────

function AssigneeChips({ logins }: { logins: string[] }) {
  if (!logins.length) return <span className="rk-muted">—</span>;
  return (
    <div className="rk-dep-chips">
      {logins.map((a) => (
        <span key={a} className="rk-chip rk-chip-readonly">@{a}</span>
      ))}
    </div>
  );
}

/** Shows dep IDs as chips, or "—". Merged from "tiene" + "depende de". */
function DepCell({ deps }: { deps: string[] }) {
  if (!deps.length) return <span className="rk-muted">—</span>;
  return (
    <div className="rk-dep-chips">
      {deps.map((d) => (
        <span key={d} className="rk-chip rk-chip-dep">{d}</span>
      ))}
    </div>
  );
}

function BlockedCell({ blocked, reason }: { blocked: boolean; reason?: string }) {
  if (!blocked) return <span className="rk-muted">—</span>;
  return (
    <span className="rk-badge rk-badge-blocked" title={reason || ""}>Sí</span>
  );
}

/** Bloqueada por campo Blocked o Status GitHub «Bloqueado». */
function taskIsBlocked(fields: {
  Blocked?: string;
  Status?: string;
}): boolean {
  if (fields.Blocked === "Sí") return true;
  return /^bloqueado$/i.test(String(fields.Status ?? "").trim());
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6 4.5V3.5h4v1M5.5 4.5l.5 8h4l.5-8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── action buttons ──────────────────────────────────────────────────────────

function ActionBtns({
  onEdit,
  onView,
  onDelete,
  editLabel,
  viewLabel,
  deleteLabel,
}: {
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
  editLabel: string;
  viewLabel: string;
  deleteLabel: string;
}) {
  return (
    <td className="rk-td-actions">
      <button type="button" className="rk-icon-btn rk-icon-btn-eye" onClick={onView} aria-label={viewLabel} title="Ver detalle">
        <EyeIcon />
      </button>
      <button type="button" className="rk-icon-btn rk-icon-btn-edit" onClick={onEdit} aria-label={editLabel} title="Editar">
        <PencilIcon />
      </button>
      <button type="button" className="rk-icon-btn rk-icon-btn-delete" onClick={onDelete} aria-label={deleteLabel} title="Eliminar">
        <TrashIcon />
      </button>
    </td>
  );
}

// ─── main table component ────────────────────────────────────────────────────

export function HierarchyTable({
  project,
  onChangeItem,
  onPatchItem,
  onPatchGeneralTask,
  onAddGeneralTask,
  onAddSubtask,
  onAddField,
  onDeleteItem,
  onDeleteGeneralTask,
}: HierarchyTableProps) {
  const { groups, orphans } = buildGroups(project);
  const options = taskOptions(project);
  const parentOptions = useMemo(
    () => parentTaskOptions(project),
    [project.generalTasks, project.items],
  );
  const sprints = sprintNames(project);
  const people = peopleLogins(project);
  const ghColumns = githubTableColumns(project);
  const editableGhColumns = githubEditableColumns(project);

  const [genId, setGenId] = useState("");
  const [genTitle, setGenTitle] = useState("");
  const [subTitle, setSubTitle] = useState("");
  const [subParent, setSubParent] = useState(parentOptions[0] ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setSubParent((cur) =>
      cur && parentOptions.includes(cur) ? cur : parentOptions[0] ?? "",
    );
  }, [parentOptions]);

  const [fText, setFText] = useState("");
  const [fEstado, setFEstado] = useState<"" | "open" | "closed">("");
  const [fTipo, setFTipo] = useState<"" | "tarea" | "subtarea">("");
  const [fAssignee, setFAssignee] = useState("");
  const [fSprint, setFSprint] = useState("");
  const [fQuarter, setFQuarter] = useState("");
  const [fBlocked, setFBlocked] = useState<"" | "sí" | "no">("");
  const [fDepends, setFDepends] = useState<"" | "sí" | "no">("");
  const [fPadre, setFPadre] = useState("");
  const [fDueSoon, setFDueSoon] = useState(false);

  const [editTarget, setEditTarget] = useState<PanelTarget | null>(null);
  const [viewTarget, setViewTarget] = useState<PanelTarget | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const filterQuery = useMemo((): TaskFilterQuery => ({
    text: fText.trim() ? [fText.trim()] : [],
    is: fEstado || undefined,
    type: fTipo || undefined,
    assignee: fAssignee ? [fAssignee] : [],
    sprint: fSprint ? [fSprint] : [],
    quarter: fQuarter ? [fQuarter] : [],
    blocked: fBlocked || undefined,
    depends: fDepends || undefined,
    padre: fPadre ? [fPadre] : [],
    dueSoon: fDueSoon || undefined,
  }), [fText, fEstado, fTipo, fAssignee, fSprint, fQuarter, fBlocked, fDepends, fPadre, fDueSoon]);

  const filtering = !isQueryEmpty(filterQuery);

  const filteredGroups = useMemo(() => {
    if (!filtering) return { groups, orphans };
    const nextGroups: Group[] = [];
    for (const g of groups) {
      const taskHit = generalTaskMatches(g.task, filterQuery);
      const kids = g.children.filter((c) => subtaskMatches(c, filterQuery));
      if (filterQuery.type === "tarea") {
        if (taskHit) nextGroups.push({ task: g.task, children: [] });
        continue;
      }
      if (filterQuery.type === "subtarea") {
        if (kids.length) nextGroups.push({ task: g.task, children: kids, contextOnly: true });
        continue;
      }
      if (taskHit) { nextGroups.push({ task: g.task, children: kids }); continue; }
      if (kids.length) nextGroups.push({ task: g.task, children: kids, contextOnly: true });
    }
    return { groups: nextGroups, orphans: orphans.filter((c) => subtaskMatches(c, filterQuery)) };
  }, [filtering, filterQuery, groups, orphans]);

  const resultCount =
    filteredGroups.groups.reduce((n, g) => n + (g.contextOnly ? 0 : 1) + g.children.length, 0) +
    filteredGroups.orphans.length;

  function clearFilters() {
    setFText(""); setFEstado(""); setFTipo(""); setFAssignee("");
    setFSprint(""); setFQuarter(""); setFBlocked(""); setFDepends("");
    setFPadre(""); setFDueSoon(false);
  }

  function submitGeneral(e: FormEvent) {
    e.preventDefault();
    const id = genId.trim().toUpperCase().replace(/\s+/g, "-");
    const title = genTitle.trim();
    if (!id || !title) { setFormError("Completá ID y título."); return; }
    if (project.generalTasks.some((t) => t.id.toLowerCase() === id.toLowerCase())) {
      setFormError(`Ya existe la tarea ${id}.`); return;
    }
    setFormError(null);
    onAddGeneralTask(id, title);
    setGenId(""); setGenTitle("");
  }

  function submitSubtask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = subTitle.trim();
    const parent = String(
      new FormData(e.currentTarget).get("subParent") ?? "",
    ).trim();
    if (!title) { setFormError("Completá el título."); return; }
    if (!parent) { setFormError("Elegí la tarea padre."); return; }
    if (!parentOptions.includes(parent)) {
      setFormError(`La tarea padre «${parent}» ya no existe.`);
      return;
    }
    setFormError(null);
    onAddSubtask(title, parent);
    setSubTitle("");
  }

  function requestDeleteItem(nodeId: string) {
    const item = project.items.find((i) => i.nodeId === nodeId);
    if (!item) return;
    const name =
      itemDisplayTitle(item) ||
      (item?.number != null ? `#${item.number}` : "esta fila");
    setDeleteConfirm({ kind: "item", nodeId, title: name });
  }

  function requestDeleteGeneralTask(id: string) {
    const task = project.generalTasks.find((t) => t.id === id);
    const label = task ? `${task.id} — ${task.title}` : id;
    setDeleteConfirm({ kind: "task", id, label });
  }

  async function confirmDelete() {
    if (!deleteConfirm || deleteBusy) return;
    setDeleteBusy(true);
    try {
      if (deleteConfirm.kind === "item") {
        const { nodeId } = deleteConfirm;
        if (editTarget?.kind === "item" && editTarget.nodeId === nodeId) {
          setEditTarget(null);
        }
        if (viewTarget?.kind === "item" && viewTarget.nodeId === nodeId) {
          setViewTarget(null);
        }
        await onDeleteItem(nodeId);
      } else {
        const { id } = deleteConfirm;
        if (editTarget?.kind === "task" && editTarget.id === id) {
          setEditTarget(null);
        }
        if (viewTarget?.kind === "task" && viewTarget.id === id) {
          setViewTarget(null);
        }
        onDeleteGeneralTask(id);
      }
      setDeleteConfirm(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  const editingTask = editTarget?.kind === "task"
    ? project.generalTasks.find((t) => t.id === editTarget.id) ?? null : null;
  const editingItem = editTarget?.kind === "item"
    ? project.items.find((i) => i.nodeId === editTarget.nodeId) ?? null : null;
  const viewingTask = viewTarget?.kind === "task"
    ? project.generalTasks.find((t) => t.id === viewTarget.id) ?? null : null;
  const viewingItem = viewTarget?.kind === "item"
    ? project.items.find((i) => i.nodeId === viewTarget.nodeId) ?? null : null;

  return (
    <div className="rk-tasks-block">
      <div className="rk-add-bar">
        <form className="rk-add-form" onSubmit={submitGeneral}>
          <input className="rk-input" placeholder="ID (ej. INICQ-500)" value={genId}
            onChange={(e) => setGenId(e.target.value)} aria-label="ID de la tarea" />
          <input className="rk-input" placeholder="Título de la tarea" value={genTitle}
            onChange={(e) => setGenTitle(e.target.value)} aria-label="Título de la tarea" />
          <button type="submit" className="rk-btn rk-btn-primary">Agregar tarea</button>
        </form>
        <form className="rk-add-form" onSubmit={submitSubtask}>
          <select
            className="rk-select-sm rk-select-task"
            name="subParent"
            value={subParent}
            onChange={(e) => setSubParent(e.target.value)}
            aria-label="Tarea padre"
          >
            {parentOptions.length === 0 && <option value="">—</option>}
            {parentOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input className="rk-input" placeholder="Título de la subtarea" value={subTitle}
            onChange={(e) => setSubTitle(e.target.value)} aria-label="Título subtarea" />
          <button type="submit" className="rk-btn rk-btn-ghost">Agregar subtarea</button>
        </form>
      </div>
      {formError && (
        <RakkauNotice variant="error" title="Revisá el formulario" onDismiss={() => setFormError(null)}>
          {formError}
        </RakkauNotice>
      )}

      <div className="rk-filter-bar" aria-label="Filtros">
        <div className="rk-filter-search">
          <input className="rk-input rk-filter-input" value={fText}
            onChange={(e) => setFText(e.target.value)}
            placeholder="Buscar por título o ID…" aria-label="Buscar" />
          {filtering && (
            <button type="button" className="rk-btn rk-btn-ghost" onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </div>
        <div className="rk-filter-grid">
          <label className="rk-label">Estado
            <select className="rk-select-sm" value={fEstado}
              onChange={(e) => setFEstado(e.target.value as "" | "open" | "closed")}>
              <option value="">Todos</option>
              <option value="open">Abiertas</option>
              <option value="closed">Cerradas</option>
            </select>
          </label>
          <label className="rk-label">Tipo
            <select className="rk-select-sm" value={fTipo}
              onChange={(e) => setFTipo(e.target.value as "" | "tarea" | "subtarea")}>
              <option value="">Todos</option>
              <option value="tarea">Tareas</option>
              <option value="subtarea">Subtareas</option>
            </select>
          </label>
          <label className="rk-label">Asignado a
            <select className="rk-select-sm" value={fAssignee}
              onChange={(e) => setFAssignee(e.target.value)}>
              <option value="">Cualquiera</option>
              {people.map((login) => <option key={login} value={login}>@{login}</option>)}
            </select>
          </label>
          <label className="rk-label">Sprint
            <select className="rk-select-sm" value={fSprint}
              onChange={(e) => setFSprint(e.target.value)}>
              <option value="">Todos</option>
              {sprints.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="rk-label">Quarter
            <select className="rk-select-sm" value={fQuarter}
              onChange={(e) => setFQuarter(e.target.value)}>
              <option value="">Todos</option>
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </label>
          <label className="rk-label">Tarea padre
            <select className="rk-select-sm" value={fPadre}
              onChange={(e) => setFPadre(e.target.value)}>
              <option value="">Todas</option>
              {options.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <label className="rk-label">Bloqueada
            <select className="rk-select-sm" value={fBlocked}
              onChange={(e) => setFBlocked(e.target.value as "" | "sí" | "no")}>
              <option value="">Todas</option>
              <option value="sí">Sí</option><option value="no">No</option>
            </select>
          </label>
          <label className="rk-label">Con dependencia
            <select className="rk-select-sm" value={fDepends}
              onChange={(e) => setFDepends(e.target.value as "" | "sí" | "no")}>
              <option value="">Todas</option>
              <option value="sí">Sí</option><option value="no">No</option>
            </select>
          </label>
          <label className="rk-label rk-filter-check">
            <span>Vence pronto</span>
            <input type="checkbox" checked={fDueSoon}
              onChange={(e) => setFDueSoon(e.target.checked)} />
          </label>
        </div>
        {filtering && (
          <p className="rk-filter-hint">
            {resultCount} resultado{resultCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="rk-table-wrap">
        <table
          className="rk-table"
          style={{
            minWidth: `${720 + ghColumns.length * 120}px`,
          }}
        >
          <thead>
            <tr>
              <th>Tarea / Subtarea</th>
              <th>Estado</th>
              <th>Asignado a</th>
              {ghColumns.map((cf) => (
                <th key={cf.id} className="rk-th-custom" title={`Campo GitHub · ${cf.dataType}`}>
                  <span className="rk-th-custom-name">{cf.name}</span>
                  {cf.pendingCreate && (
                    <span className="rk-th-pending" title="Pendiente de publicar en GitHub">•</span>
                  )}
                </th>
              ))}
              <th className="rk-th-actions">
                <button
                  type="button"
                  className="rk-btn-add-col"
                  onClick={() => setShowAddField(true)}
                  title="Agregar columna personalizada"
                  aria-label="Agregar columna"
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.groups.map((g) => (
              <GroupRows
                key={g.task.id}
                group={g}
                project={project}
                customFields={ghColumns}
                onEditTask={(id) => setEditTarget({ kind: "task", id })}
                onEditItem={(nodeId) => setEditTarget({ kind: "item", nodeId })}
                onViewTask={(id) => setViewTarget({ kind: "task", id })}
                onViewItem={(nodeId) => setViewTarget({ kind: "item", nodeId })}
                onDeleteTask={requestDeleteGeneralTask}
                onDeleteItem={requestDeleteItem}
              />
            ))}
            {filteredGroups.orphans.map((item) => (
              <ItemRow
                key={item.nodeId}
                item={item}
                customFields={ghColumns}
                onEdit={() => setEditTarget({ kind: "item", nodeId: item.nodeId })}
                onView={() => setViewTarget({ kind: "item", nodeId: item.nodeId })}
                onDelete={() => requestDeleteItem(item.nodeId)}
              />
            ))}
            {filtering && filteredGroups.groups.length === 0 && filteredGroups.orphans.length === 0 && (
              <tr className="rk-row-child rk-row-empty">
                <td colSpan={totalCols(ghColumns)}>Ningún resultado para ese filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editTarget && (editingTask || editingItem) && (
        <EditPanel
          project={project}
          options={options}
          sprints={sprints}
          people={people}
          customFields={editableGhColumns}
          task={editingTask}
          item={editingItem}
          onClose={() => setEditTarget(null)}
          onChangeItem={onChangeItem}
          onPatchItem={onPatchItem}
          onPatchGeneralTask={onPatchGeneralTask}
        />
      )}

      {viewTarget && (viewingTask || viewingItem) && (
        <ViewPanel
          task={viewingTask}
          item={viewingItem}
          onClose={() => setViewTarget(null)}
        />
      )}

      {showAddField && (
        <AddFieldPanel
          onAdd={(field) => onAddField(field)}
          onClose={() => setShowAddField(false)}
        />
      )}

      <RakkauConfirmDialog
        open={deleteConfirm != null}
        title={
          deleteConfirm?.kind === "item"
            ? "Eliminar del proyecto"
            : "Eliminar tarea"
        }
        description={
          deleteConfirm?.kind === "item"
            ? `Se quitará «${deleteConfirm.title}» del project. En GitHub también se elimina la fila del tablero.`
            : deleteConfirm
              ? `Se eliminará «${deleteConfirm.label}». Las subtareas quedarán sin tarea padre.`
              : ""
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleteBusy) setDeleteConfirm(null);
        }}
      />
    </div>
  );
}

// ─── GroupRows ───────────────────────────────────────────────────────────────

function GroupRows({
  group,
  project,
  customFields,
  onEditTask,
  onEditItem,
  onViewTask,
  onViewItem,
  onDeleteTask,
  onDeleteItem,
}: {
  group: Group;
  project: ProjectDocument;
  customFields: ProjectField[];
  onEditTask: (id: string) => void;
  onEditItem: (nodeId: string) => void;
  onViewTask: (id: string) => void;
  onViewItem: (nodeId: string) => void;
  onDeleteTask: (id: string) => void;
  onDeleteItem: (nodeId: string) => void;
}) {
  return (
    <>
      {group.contextOnly ? (
        <tr className="rk-row-context">
          <td colSpan={totalCols(customFields)}>
            <div className="rk-task-cell">
              <div className="rk-task-cell-head">
                <span className="rk-badge rk-badge-general">Tarea</span>
                <span className="rk-parent-id">{group.task.id}</span>
              </div>
              <div className="rk-task-cell-title">{group.task.title}</div>
            </div>
          </td>
        </tr>
      ) : (
        <GeneralTaskRow
          task={group.task}
          customFields={customFields}
          childCount={
            project.items.filter(
              (i) => resolveItemParentTaskId(i) === group.task.id,
            ).length || group.children.length
          }
          onEdit={() => onEditTask(group.task.id)}
          onView={() => onViewTask(group.task.id)}
          onDelete={() => onDeleteTask(group.task.id)}
        />
      )}
      {group.children.map((item) => (
        <ItemRow
          key={item.nodeId}
          item={item}
          customFields={customFields}
          onEdit={() => onEditItem(item.nodeId)}
          onView={() => onViewItem(item.nodeId)}
          onDelete={() => onDeleteItem(item.nodeId)}
        />
      ))}
      {!group.contextOnly && group.children.length === 0 && (
        <tr className="rk-row-child rk-row-empty">
          <td className="rk-child-indent" colSpan={totalCols(customFields)}>Sin subtareas</td>
        </tr>
      )}
    </>
  );
}

// ─── GeneralTaskRow (read-only) ───────────────────────────────────────────────

function GeneralTaskRow({
  task,
  childCount,
  customFields,
  onEdit,
  onView,
  onDelete,
}: {
  task: GeneralTask;
  childCount: number;
  customFields: ProjectField[];
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
}) {
  const deps = parseDeps(task.DependsOn);
  const dueCls = dueNearClass(task.DueDate, task.Status);
  const st = generalTaskStatusDisplay(task);

  return (
    <tr className={`rk-row-parent rk-row-readonly${deps.length ? " rk-row-has-dep" : ""}${dueCls}`}>
      <td>
        <div className="rk-task-cell">
          <div className="rk-task-cell-head">
            <span className="rk-badge rk-badge-general">Tarea</span>
            <span className="rk-parent-id">{task.id}</span>
            <span className="rk-parent-meta">{childCount} subtarea{childCount === 1 ? "" : "s"}</span>
          </div>
          <div className="rk-task-cell-title">{task.title}</div>
        </div>
      </td>
      <td>
        <span className={`rk-state ${st.open ? "rk-state-open" : "rk-state-closed"}`}>{st.text}</span>
      </td>
      <td><AssigneeChips logins={task.assignees ?? []} /></td>
      {customFields.map((cf) => (
        <td key={cf.id} className="rk-col-custom">
          <GitHubFieldCell field={cf} task={task} />
        </td>
      ))}
      <ActionBtns
        onEdit={onEdit}
        onView={onView}
        onDelete={onDelete}
        editLabel={`Editar tarea ${task.id}`}
        viewLabel={`Ver detalle de ${task.id}`}
        deleteLabel={`Eliminar tarea ${task.id}`}
      />
    </tr>
  );
}

// ─── ItemRow (read-only) ──────────────────────────────────────────────────────

function ItemRow({
  item,
  customFields,
  onEdit,
  onView,
  onDelete,
}: {
  item: ProjectItem;
  customFields: ProjectField[];
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
}) {
  const deps = parseDeps(item.fieldValues.DependsOn);
  const dueCls = dueNearClass(
    item.fieldValues.DueDate,
    item.fieldValues.Status,
    item.state,
  );
  const taskVal = Array.isArray(item.fieldValues.Task)
    ? item.fieldValues.Task[0] ?? "" : item.fieldValues.Task ?? "";
  const st = itemStatusDisplay(item);
  // Ítems sin tarea padre se tratan visualmente como Tareas principales
  const isOrphan = !taskVal;

  if (isOrphan) {
    // ─── Vista de TAREA (ítem sin padre) ──────────────────────────
    return (
      <tr className={`rk-row-parent rk-row-readonly${deps.length ? " rk-row-has-dep" : ""}${dueCls}`}>
        <td>
          <div className="rk-task-cell">
            <div className="rk-task-cell-head">
              <span className="rk-badge rk-badge-general">Tarea</span>
              {item.number != null && (
                <span className="rk-parent-id">#{item.number}</span>
              )}
              {item.contentType === "DraftIssue" && (
                <span className="rk-parent-meta">borrador GH</span>
              )}
            </div>
            <div className="rk-task-cell-title">
              {item.url ? (
                <a className="rk-title-link" href={item.url} target="_blank" rel="noreferrer">
                  {itemDisplayTitle(item)}
                </a>
              ) : (
                <span className="rk-title-link">{itemDisplayTitle(item)}</span>
              )}
            </div>
          </div>
        </td>
        <td>
          <span className={`rk-state ${st.open ? "rk-state-open" : "rk-state-closed"}`}>{st.text}</span>
        </td>
        <td><AssigneeChips logins={item.assignees ?? []} /></td>
        {customFields.map((cf) => (
          <td key={cf.id} className="rk-col-custom">
            <GitHubFieldCell field={cf} item={item} />
          </td>
        ))}
        <ActionBtns
          onEdit={onEdit}
          onView={onView}
          onDelete={onDelete}
          editLabel={`Editar tarea${item.number != null ? ` #${item.number}` : ""}`}
          viewLabel={`Ver detalle${item.number != null ? ` #${item.number}` : ""}`}
          deleteLabel={`Eliminar tarea${item.number != null ? ` #${item.number}` : ""}`}
        />
      </tr>
    );
  }

  // ─── Vista de SUBTAREA (ítem con padre) ─────────────────────────
  return (
    <tr className={`rk-row-child rk-row-readonly${deps.length ? " rk-row-has-dep" : ""}${dueCls}`}>
      <td className="rk-child-indent">
        <div className="rk-task-cell">
          <div className="rk-task-cell-head">
            <span className="rk-badge rk-badge-sub">Subtarea</span>
            {item.number != null && (
              <span className="rk-parent-id">#{item.number}</span>
            )}
          </div>
          <div className="rk-task-cell-title">
            {item.url ? (
              <a className="rk-title-link" href={item.url} target="_blank" rel="noreferrer">
                {itemDisplayTitle(item)}
              </a>
            ) : (
              <span className="rk-title-link">{itemDisplayTitle(item)}</span>
            )}
          </div>
        </div>
      </td>
      <td>
        <span className={`rk-state ${st.open ? "rk-state-open" : "rk-state-closed"}`}>{st.text}</span>
      </td>
      <td><AssigneeChips logins={item.assignees ?? []} /></td>
      {customFields.map((cf) => (
        <td key={cf.id} className="rk-col-custom">
          <GitHubFieldCell field={cf} item={item} />
        </td>
      ))}
      <ActionBtns
        onEdit={onEdit}
        onView={onView}
        onDelete={onDelete}
        editLabel={`Editar subtarea ${itemDisplayTitle(item)}`}
        viewLabel={`Ver detalle de subtarea ${itemDisplayTitle(item)}`}
        deleteLabel={`Eliminar subtarea ${itemDisplayTitle(item)}`}
      />
    </tr>
  );
}

// ─── ViewPanel (detail / read-only) ──────────────────────────────────────────

function ViewPanel({
  task,
  item,
  onClose,
}: {
  task: GeneralTask | null;
  item: ProjectItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isTask = Boolean(task);
  const title = task?.title ?? (item ? itemDisplayTitle(item) : "");
  const itemTaskVal = item
    ? (Array.isArray(item.fieldValues.Task) ? item.fieldValues.Task[0] ?? "" : item.fieldValues.Task ?? "")
    : "";
  const itemIsOrphan = item && !itemTaskVal;
  const kicker = isTask
    ? `Tarea · ${task!.id}`
    : itemIsOrphan
      ? `Tarea${item!.number != null ? ` · #${item!.number}` : ""}`
      : `Subtarea${item?.number != null ? ` · #${item.number}` : ""}`;
  const st = task
    ? generalTaskStatusDisplay(task)
    : item
      ? itemStatusDisplay(item)
      : statusView(undefined);
  const deps = parseDeps(task?.DependsOn ?? item?.fieldValues.DependsOn);
  const blocked = taskIsBlocked({
    Blocked: task?.Blocked ?? item?.fieldValues.Blocked,
    Status: task?.Status ?? item?.fieldValues.Status,
  });
  const blockReason = task?.BlockedReason ?? item?.fieldValues.BlockedReason ?? "";
  const assignees = task?.assignees ?? item?.assignees ?? [];
  const due = task?.DueDate ?? item?.fieldValues.DueDate;
  const sprint = task?.Sprint ?? item?.fieldValues.Sprint;
  const quarter = task?.Quarter ?? item?.fieldValues.Quarter;
  const parent = itemIsOrphan ? null : (itemTaskVal || null);

  return (
    <div className="rk-edit-overlay" role="presentation" onClick={onClose}>
      <aside
        className="rk-edit-panel rk-view-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle: ${kicker}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rk-edit-panel-head">
          <div>
            <p className="rk-edit-kicker">{kicker}</p>
            <h3 className="rk-edit-title">{title}</h3>
          </div>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose}>Cerrar</button>
        </header>

        <div className="rk-view-meta-bar">
          <span className={`rk-state ${st.open ? "rk-state-open" : "rk-state-closed"}`}>{st.text}</span>
          {sprint && <span className="rk-view-meta-pill">{sprint}</span>}
          {quarter && <span className="rk-view-meta-pill">{quarter}</span>}
          {due && <span className="rk-view-meta-pill">Vence {formatDue(due)}</span>}
          {parent && <span className="rk-view-meta-pill">↑ {parent}</span>}
        </div>

        {assignees.length > 0 && (
          <div className="rk-view-section">
            <p className="rk-view-section-label">Asignado a</p>
            <div className="rk-dep-chips">
              {assignees.map((a) => (
                <span key={a} className="rk-chip rk-chip-readonly">@{a}</span>
              ))}
            </div>
          </div>
        )}

        <div className="rk-view-section">
          <p className="rk-view-section-label">
            <span className={deps.length ? "rk-view-label-accent" : ""}>
              Dependencias
            </span>
          </p>
          {deps.length === 0 ? (
            <p className="rk-view-empty">Sin dependencias registradas</p>
          ) : (
            <>
              <div className="rk-dep-chips" style={{ marginBottom: "0.45rem" }}>
                {deps.map((d) => (
                  <span key={d} className="rk-chip rk-chip-dep">{d}</span>
                ))}
              </div>
              <p className="rk-view-empty rk-view-hint">
                Esta tarea depende de las anteriores para avanzar.
              </p>
            </>
          )}
        </div>

        <div className="rk-view-section">
          <p className="rk-view-section-label">
            <span className={blocked ? "rk-view-label-danger" : ""}>
              Bloqueo
            </span>
          </p>
          {!blocked ? (
            <p className="rk-view-empty">No bloqueada</p>
          ) : (
            <div className="rk-view-block-card">
              <div className="rk-view-block-icon">⚠</div>
              <div>
                <p className="rk-view-block-title">Esta tarea está bloqueada</p>
                {blockReason ? (
                  <p className="rk-view-block-reason">{blockReason}</p>
                ) : (
                  <p className="rk-view-empty">Sin motivo registrado. Editá para agregar contexto.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── EditPanel ────────────────────────────────────────────────────────────────

function EditPanel({
  project,
  options,
  sprints,
  people,
  customFields,
  task,
  item,
  onClose,
  onChangeItem,
  onPatchItem,
  onPatchGeneralTask,
}: {
  project: ProjectDocument;
  options: string[];
  sprints: string[];
  people: string[];
  customFields: ProjectField[];
  task: GeneralTask | null;
  item: ProjectItem | null;
  onClose: () => void;
  onChangeItem: HierarchyTableProps["onChangeItem"];
  onPatchItem: HierarchyTableProps["onPatchItem"];
  onPatchGeneralTask: HierarchyTableProps["onPatchGeneralTask"];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isTask = Boolean(task);
  const taskVal = item
    ? Array.isArray(item.fieldValues.Task) ? item.fieldValues.Task[0] ?? "" : item.fieldValues.Task ?? ""
    : "";
  const itemIsOrphan = item && !taskVal;
  const heading = isTask
    ? `Tarea · ${task!.id}`
    : itemIsOrphan
      ? `Tarea${item!.number != null ? ` · #${item!.number}` : ""}`
      : `Subtarea${item?.number != null ? ` · #${item.number}` : ""}`;
  const title = task?.title ?? (item ? itemDisplayTitle(item) : "");
  const assignees = task?.assignees ?? item?.assignees ?? [];
  const deps = parseDeps(task?.DependsOn ?? item?.fieldValues.DependsOn);
  const targets = dependencyTargets(project, item?.nodeId ?? `task:${task?.id ?? ""}`);
  const hasDep = (task?.HasDependency ?? item?.fieldValues.HasDependency) === "Sí";
  const blockReasonVal =
    task?.BlockedReason ?? item?.fieldValues.BlockedReason ?? "";
  const blocked = taskIsBlocked({
    Blocked: task?.Blocked ?? item?.fieldValues.Blocked,
    Status: item?.fieldValues.Status,
  });
  const showBlockReason =
    blocked || (isTask && blockReasonVal.trim().length > 0);
  const statusField = githubStatusField(project);

  function patchBlockReason(value: string) {
    const byStatus = item
      ? /^bloqueado$/i.test(String(item.fieldValues.Status ?? "").trim())
      : false;
    const Blocked = byStatus || value.trim() ? "Sí" : "No";
    const BlockedReason = value;
    if (task) patchTask({ BlockedReason, Blocked });
    else patchFields({ BlockedReason, Blocked });
  }

  function patchTask(p: Partial<GeneralTask>) { if (task) onPatchGeneralTask(task.id, p); }
  function patchFields(p: Partial<ProjectItem["fieldValues"]>) { if (item) onChangeItem(item.nodeId, p); }

  function setAssignees(next: string[]) {
    if (task) { onPatchGeneralTask(task.id, { assignees: next }); return; }
    if (item) onPatchItem(item.nodeId, { assignees: next, fieldValues: { ...item.fieldValues, Assignees: next } });
  }

  function toggleAssignee(login: string) {
    const set = new Set(assignees);
    set.has(login) ? set.delete(login) : set.add(login);
    setAssignees(Array.from(set));
  }

  function addAssignee(login: string) {
    if (!login || assignees.includes(login)) return;
    setAssignees([...assignees, login]);
  }

  function toggleDep(value: string) {
    const set = new Set(deps);
    set.has(value) ? set.delete(value) : set.add(value);
    const DependsOn = Array.from(set).join(", ");
    if (task) { onPatchGeneralTask(task.id, { HasDependency: "Sí", DependsOn }); return; }
    patchFields({ HasDependency: "Sí", DependsOn });
  }

  return (
    <div className="rk-edit-overlay" role="presentation" onClick={onClose}>
      <aside
        className="rk-edit-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar ${heading}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rk-edit-panel-head">
          <div>
            <p className="rk-edit-kicker">{heading}</p>
            <h3 className="rk-edit-title">{title}</h3>
          </div>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose}>Cerrar</button>
        </header>

        <div className="rk-edit-panel-body">
          {/* ── Título (task o item) ────────────────────────────────── */}
          <label className="rk-label">Título
            <input
              className="rk-input"
              value={task?.title ?? (item ? itemDisplayTitle(item) : "")}
              onChange={(e) => {
                const nextTitle = e.target.value;
                if (task) { patchTask({ title: nextTitle }); return; }
                if (item) {
                  onPatchItem(item.nodeId, {
                    title: nextTitle,
                    fieldValues: { Title: nextTitle },
                  });
                }
              }}
            />
          </label>

          {/* ── Status (GitHub Projects) ──────────────────────────────── */}
          <label className="rk-label">
            {statusField ? "Status" : "Estado"}
            {task && statusField ? (
              <select
                className="rk-select-sm rk-select-status"
                value={String(task.Status ?? "")}
                onChange={(e) => {
                  const Status = e.target.value;
                  const blockedNext = /^bloqueado$/i.test(Status.trim())
                    ? "Sí"
                    : "No";
                  patchTask({
                    Status,
                    Blocked: blockedNext,
                    ...(blockedNext === "No" ? { BlockedReason: "" } : {}),
                  });
                }}
              >
                <option value="">—</option>
                {(statusField.options ?? []).map((o) => (
                  <option key={o.id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : task ? (
              <select
                className="rk-select-sm rk-select-status"
                value={
                  String(task.Status ?? "OPEN").toUpperCase() === "CLOSED"
                    ? "CLOSED"
                    : "OPEN"
                }
                onChange={(e) => patchTask({ Status: e.target.value })}
              >
                <option value="OPEN">Abierta</option>
                <option value="CLOSED">Cerrada</option>
              </select>
            ) : item && statusField ? (
              <select className="rk-select-sm rk-select-status"
                value={String(item.fieldValues.Status ?? "")}
                onChange={(e) => {
                  const Status = e.target.value;
                  const blockedNext = /^bloqueado$/i.test(Status.trim())
                    ? "Sí"
                    : "No";
                  patchFields({
                    Status,
                    Blocked: blockedNext,
                    ...(blockedNext === "No" ? { BlockedReason: "" } : {}),
                  });
                  if (item.contentType === "Issue") {
                    onPatchItem(item.nodeId, {
                      state: issueStateFromProjectStatus(Status),
                    });
                  }
                }}>
                <option value="">—</option>
                {(statusField.options ?? []).map((o) => (
                  <option key={o.id} value={o.name}>{o.name}</option>
                ))}
              </select>
            ) : item ? (
              <select className="rk-select-sm rk-select-status"
                value={String(item.state ?? "OPEN").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN"}
                onChange={(e) => {
                  if (!item) return;
                  onPatchItem(item.nodeId, { state: e.target.value as "OPEN" | "CLOSED" });
                }}>
                <option value="OPEN">Abierta</option>
                <option value="CLOSED">Cerrada</option>
              </select>
            ) : null}
          </label>

          {item && (
            <label className="rk-label">Tarea padre
              <select className="rk-select-sm" value={taskVal}
                onChange={(e) => patchFields({ Task: e.target.value ? [e.target.value] : [] })}>
                <option value="">— Sin asignar —</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}

          <div className="rk-label">Asignado a
            <div className="rk-assignee-picker">
              <select className="rk-select-sm rk-select-dep" value=""
                onChange={(e) => { if (e.target.value) addAssignee(e.target.value); }}>
                <option value="">Asignar…</option>
                {people.map((login) => <option key={login} value={login}>@{login}</option>)}
              </select>
              <input className="rk-input rk-input-assignee" placeholder="@login + Enter"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const login = (e.target as HTMLInputElement).value.trim().replace(/^@/, "");
                  if (!login) return;
                  addAssignee(login);
                  (e.target as HTMLInputElement).value = "";
                }} />
              {assignees.length > 0 && (
                <div className="rk-dep-chips">
                  {assignees.map((a) => (
                    <button key={a} type="button" className="rk-chip" onClick={() => toggleAssignee(a)}>
                      @{a} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className="rk-label">Vencimiento
            <input className="rk-input rk-input-date" type="date"
              value={(task?.DueDate ?? item?.fieldValues.DueDate)?.slice(0, 10) ?? ""}
              onChange={(e) => {
                const DueDate = e.target.value || undefined;
                if (task) patchTask({ DueDate }); else patchFields({ DueDate });
              }} />
          </label>

          <label className="rk-label">¿Tiene dependencia?
            <select className="rk-select-sm"
              value={task?.HasDependency ?? item?.fieldValues.HasDependency ?? ""}
              onChange={(e) => {
                const v = e.target.value as "Sí" | "No" | "";
                if (task) patchTask({ HasDependency: v, DependsOn: v === "Sí" ? task.DependsOn ?? "" : "" });
                else patchFields({ HasDependency: v, DependsOn: v === "Sí" ? item?.fieldValues.DependsOn ?? "" : "" });
              }}>
              <option value="">—</option>
              <option value="Sí">Sí</option>
              <option value="No">No</option>
            </select>
          </label>

          {hasDep && (
            <div className="rk-label">Depende de
              <div className="rk-dep-picker">
                <select className="rk-select-sm rk-select-dep" value=""
                  onChange={(e) => { if (e.target.value) toggleDep(e.target.value); }}>
                  <option value="">Agregar dependencia…</option>
                  {targets.filter((t) => t.value !== task?.id).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {deps.length > 0 && (
                  <div className="rk-dep-chips">
                    {deps.map((d) => (
                      <button key={d} type="button" className="rk-chip" onClick={() => toggleDep(d)}>
                        {d} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="rk-label">Sprint
            <select className="rk-select-sm"
              value={task?.Sprint ?? item?.fieldValues.Sprint ?? ""}
              onChange={(e) => { if (task) patchTask({ Sprint: e.target.value }); else patchFields({ Sprint: e.target.value }); }}>
              <option value="">—</option>
              {sprints.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="rk-label">Quarter
            <select className="rk-select-sm"
              value={task?.Quarter ?? item?.fieldValues.Quarter ?? ""}
              onChange={(e) => { if (task) patchTask({ Quarter: e.target.value }); else patchFields({ Quarter: e.target.value }); }}>
              <option value="">—</option>
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </label>

          {showBlockReason && (
            <label className="rk-label">Motivo de bloqueo
              <input
                className="rk-input rk-blocked-reason"
                value={blockReasonVal}
                onChange={(e) => patchBlockReason(e.target.value)}
                placeholder="¿Por qué está bloqueada?"
              />
            </label>
          )}

          {/* ── Campos personalizados del proyecto ────────────────── */}
          {customFields.length > 0 && (
            <>
              <div className="rk-custom-fields-divider">
                <span>Campos del proyecto</span>
              </div>
              {customFields.map((cf) => {
                const current = item ? (item.fieldValues[cf.name] ?? "") : "";
                const currentStr = Array.isArray(current) ? current[0] ?? "" : String(current);

                function setCustom(val: string) {
                  if (item) patchFields({ [cf.name]: val });
                }

                if (cf.dataType === "SINGLE_SELECT") {
                  return (
                    <label key={cf.id} className="rk-label">{cf.name}
                      <select
                        className="rk-select-sm"
                        value={currentStr}
                        onChange={(e) => setCustom(e.target.value)}
                      >
                        <option value="">—</option>
                        {(cf.options ?? []).map((o) => (
                          <option key={o.id} value={o.name}>{o.name}</option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (cf.dataType === "DATE") {
                  return (
                    <label key={cf.id} className="rk-label">{cf.name}
                      <input
                        className="rk-input rk-input-date"
                        type="date"
                        value={currentStr.slice(0, 10)}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                    </label>
                  );
                }
                if (cf.dataType === "NUMBER") {
                  return (
                    <label key={cf.id} className="rk-label">{cf.name}
                      <input
                        className="rk-input"
                        type="number"
                        value={currentStr}
                        onChange={(e) => setCustom(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  );
                }
                // TEXT (default)
                return (
                  <label key={cf.id} className="rk-label">{cf.name}
                    <input
                      className="rk-input"
                      type="text"
                      value={currentStr}
                      onChange={(e) => setCustom(e.target.value)}
                      placeholder="—"
                    />
                  </label>
                );
              })}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
