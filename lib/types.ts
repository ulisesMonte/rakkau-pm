/** Canonical JSON schema for Rakkau Ops Platform (no DB). */

export type FieldDataType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "ITERATION"
  | "TITLE"
  | "ASSIGNEES"
  | "LABELS"
  | "MILESTONE"
  | "REPOSITORY"
  | "TRACKED_BY"
  | "TRACKS"
  | "LINKED_PULL_REQUESTS"
  | "REVIEWERS"
  | "PARENT_ISSUE"
  | "SUB_ISSUES_PROGRESS"
  | "STATUS";

export interface FieldOption {
  id: string;
  name: string;
  color?: string;
  description?: string;
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: FieldDataType;
  options?: FieldOption[];
  /** True when created locally and not yet pushed to GitHub */
  pendingCreate?: boolean;
  /** Clave Rakkau si el nombre coincide con CANONICAL_FIELDS (ver projectFieldsSchema). */
  canonicalKey?: (typeof CANONICAL_FIELDS)[keyof typeof CANONICAL_FIELDS];
  /** Origen del registro de columna en nuestro JSON. */
  origin?: "github" | "local_pending";
}

export type YesNoValue = "Sí" | "No" | "";
/** @deprecated Prefer YesNoValue — alias for Blocked */
export type BlockedValue = YesNoValue;

/** Quién lleva la tarea general: Rakkau o el cliente. */
export type ResponsableValue = "rakkau" | "cliente" | "";

/** Estado operativo de la tarea general (distinto del Status nativo de GitHub). */
export type EstadoOperativoValue = "a tiempo" | "impactado" | "pausado" | "";

/** Iniciativa / ID de negocio (opciones del field Task). */
export interface GeneralTask {
  id: string;
  title: string;
  description?: string;
  /** Mismos atributos de planificación que una subtarea */
  DueDate?: string;
  assignees?: string[];
  HasDependency?: YesNoValue;
  DependsOn?: string;
  Sprint?: string;
  Quarter?: string;
  Blocked?: YesNoValue;
  BlockedReason?: string;
  /** Responsable del issue / tarea general → GitHub Responsable */
  Responsable?: ResponsableValue;
  /** Salud operativa → GitHub EstadoOperativo */
  EstadoOperativo?: EstadoOperativoValue;
  /** Status nativo GitHub Projects (Todo / Done / …) */
  Status?: string;
  /** Macro / objetivo de Q al que pertenece (local). */
  parentMacroId?: string | null;
  /** ProjectV2Item id en GitHub (fila del project). */
  githubProjectItemNodeId?: string | null;
  /** Issue / DraftIssue id (contenido). */
  githubContentNodeId?: string | null;
  issueNumber?: number | null;
  url?: string | null;
  /** Columnas GitHub custom (p. ej. Track / Journey) no mapeadas a props top-level. */
  githubFieldValues?: ItemFieldValues;
}

export type QuarterKey = "Q1" | "Q2" | "Q3" | "Q4";

export type SprintStatus = "planned" | "active" | "done";

export interface Sprint {
  id: string;
  name: string;
  quarter: QuarterKey;
  year: number;
  status: SprintStatus;
  startDate?: string;
  endDate?: string;
  /** Color de acento en calendario (#RRGGBB) */
  color?: string;
}

/** Paleta sugerida al crear sprints */
export const SPRINT_COLOR_PRESETS = [
  "#2dd4bf",
  "#38bdf8",
  "#a78bfa",
  "#e879a9",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#818cf8",
] as const;

export interface CurrentQuarter {
  quarter: QuarterKey;
  year: number;
}

/**
 * Objetivo de una etapa dentro de un macro de Q.
 * Persistido en JSON local (no es columna GitHub por fila de etapa).
 */
export interface StageObjective {
  id: string;
  /** Etiqueta corta (ej. Discovery, Entrega). */
  name: string;
  /** Objetivo concreto a cumplir en esta etapa. */
  objective: string;
  /** Vencimiento ISO YYYY-MM-DD (anclado al Q). */
  dueDate: string;
  /** Si el objetivo de la etapa se cumplió. */
  done: boolean;
  doneAt?: string | null;
  notes?: string;
}

/**
 * Tarea macro: nivel por encima de las tareas generales.
 * Agrupa objetivos por etapas a lo largo del Quarter.
 */
export interface MacroTask {
  id: string;
  title: string;
  description?: string;
  quarter: QuarterKey;
  year: number;
  stages: StageObjective[];
  EstadoOperativo?: EstadoOperativoValue;
  Responsable?: ResponsableValue;
  /** generalTask.id vinculados a este macro. */
  generalTaskIds?: string[];
  createdAt?: string;
}

export interface ItemFieldValues {
  /** Parent initiative IDs (Task MULTI_SELECT) */
  Task?: string | string[];
  /** Legacy / “está bloqueada” */
  Blocked?: YesNoValue;
  BlockedReason?: string;
  /** ¿Tiene dependencia? → GitHub HasDependency */
  HasDependency?: YesNoValue;
  /** Refs a otras tareas/issues (coma-separado o multi) → GitHub DependsOn */
  DependsOn?: string;
  Status?: string;
  Sprint?: string;
  Quarter?: string;
  /** Vencimiento ISO YYYY-MM-DD → GitHub DueDate (DATE) */
  DueDate?: string;
  /** Responsable → GitHub Responsable (SINGLE_SELECT) */
  Responsable?: ResponsableValue | string;
  /** Estado operativo (tarea general) → GitHub EstadoOperativo */
  EstadoOperativo?: EstadoOperativoValue | string;
  /** Logins asignados (espejo local; también en item.assignees) */
  Assignees?: string | string[];
  [key: string]: string | string[] | undefined;
}

export interface ProjectPerson {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface ProjectItem {
  nodeId: string;
  /** Node ID del contenido (DraftIssue id, Issue id, etc.) para mutaciones directas */
  contentNodeId?: string | null;
  number: number | null;
  title: string;
  state: "OPEN" | "CLOSED" | "DRAFT" | string;
  url: string | null;
  contentType: "Issue" | "DraftIssue" | "PullRequest" | "Unknown";
  fieldValues: ItemFieldValues;
  /** Derived from Task MULTI_SELECT — first option = parent initiative id */
  parentTaskId: string | null;
  /** Logins asignados (desde GitHub Issue.assignees o edición local) */
  assignees: string[];
  /** Issue padre en GitHub (sub-issues API), si aplica. */
  parentIssueContentId?: string | null;
  blockedBy?: string[];
  blocks?: string[];
}

export interface ProjectLinks {
  blockedBy: Record<string, string[]>;
  blocks: Record<string, string[]>;
}

export interface ProjectDocument {
  projectId: string;
  number: number;
  title: string;
  owner: string;
  url?: string;
  pulledAt: string | null;
  dirty: boolean;
  fields: ProjectField[];
  generalTasks: GeneralTask[];
  items: ProjectItem[];
  links: ProjectLinks;
  /**
   * Macros / objetivos de Q con etapas (local-first).
   * Se conservan en pull; no se pisan desde GitHub.
   */
  macroTasks?: MacroTask[];
  /** Sprints locales (también push a fields Sprint/Quarter si existen) */
  sprints?: Sprint[];
  currentQuarter?: CurrentQuarter;
  /** Personas conocidas para asignar (union de assignees + owner) */
  people?: ProjectPerson[];
  /**
   * Repo `owner/name` elegido en la UI para crear issues / sub-issues al publicar.
   * Tiene prioridad sobre `GH_ISSUE_REPOSITORY` del entorno.
   */
  issueRepository?: string | null;
  /**
   * Repos descubiertos (vinculados al Project, ítems, owner).
   * Alimentan el selector «Repo de issues».
   */
  availableRepositories?: string[];
  /** Versión del esquema de columnas (`PROJECT_FIELDS_SCHEMA_VERSION`). */
  fieldsSchemaVersion?: number;
  /** Versión del esquema de tasks (`PROJECT_TASKS_SCHEMA_VERSION`). */
  tasksSchemaVersion?: number;
}

export interface IndexEntry {
  projectId: string;
  number: number;
  title: string;
  owner: string;
  path: string;
  dirty: boolean;
  pulledAt: string | null;
  /** Espejo del `issueRepository` del JSON del project. */
  issueRepository?: string | null;
}

export interface ProjectsIndex {
  updatedAt: string;
  projects: IndexEntry[];
}

export interface GitHubProjectSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  owner: string;
  /** Repos vinculados al Project v2 (si la API los devolvió). */
  repositories?: string[];
}

/** Canonical custom field names for v1 */
export const CANONICAL_FIELDS = {
  Task: "Task",
  Blocked: "Blocked",
  BlockedReason: "BlockedReason",
  HasDependency: "HasDependency",
  DependsOn: "DependsOn",
  Sprint: "Sprint",
  Quarter: "Quarter",
  DueDate: "DueDate",
  Responsable: "Responsable",
  EstadoOperativo: "EstadoOperativo",
} as const;

export const YES_NO_OPTIONS: FieldOption[] = [
  { id: "opt-yes", name: "Sí", color: "RED" },
  { id: "opt-no", name: "No", color: "GREEN" },
];

export const RESPONSABLE_OPTIONS: FieldOption[] = [
  { id: "opt-resp-rakkau", name: "rakkau", color: "PURPLE", description: "Equipo Rakkau" },
  { id: "opt-resp-cliente", name: "cliente", color: "BLUE", description: "Cliente" },
];

export const ESTADO_OPERATIVO_OPTIONS: FieldOption[] = [
  { id: "opt-eo-atiempo", name: "a tiempo", color: "GREEN", description: "Dentro de plan" },
  { id: "opt-eo-impactado", name: "impactado", color: "ORANGE", description: "Con desvío / bloqueo" },
  { id: "opt-eo-pausado", name: "pausado", color: "GRAY", description: "En pausa" },
];

/** @deprecated use YES_NO_OPTIONS */
export const BLOCKED_OPTIONS: FieldOption[] = [
  { id: "opt-blocked-si", name: "Sí", color: "RED" },
  { id: "opt-blocked-no", name: "No", color: "GREEN" },
];

export const QUARTER_OPTIONS: FieldOption[] = [
  { id: "opt-q1", name: "Q1", color: "BLUE" },
  { id: "opt-q2", name: "Q2", color: "GREEN" },
  { id: "opt-q3", name: "Q3", color: "YELLOW" },
  { id: "opt-q4", name: "Q4", color: "ORANGE" },
];

export function currentCalendarQuarter(d = new Date()): CurrentQuarter {
  const q = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { quarter: `Q${q}` as QuarterKey, year: d.getFullYear() };
}

/** Sprints del Q actual que aún no están en done. */
export function sprintsRemainingInQuarter(
  sprints: Sprint[] | undefined,
  cq: CurrentQuarter | undefined,
): { remaining: number; total: number; done: number } {
  if (!cq || !sprints?.length) return { remaining: 0, total: 0, done: 0 };
  const inQ = sprints.filter(
    (s) => s.quarter === cq.quarter && s.year === cq.year,
  );
  const done = inQ.filter((s) => s.status === "done").length;
  return { remaining: inQ.length - done, total: inQ.length, done };
}
