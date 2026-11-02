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
}

export type YesNoValue = "Sí" | "No" | "";
/** @deprecated Prefer YesNoValue — alias for Blocked */
export type BlockedValue = YesNoValue;

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
  Status?: string;
  /** ProjectV2Item id en GitHub (fila del project). */
  githubProjectItemNodeId?: string | null;
  /** Issue / DraftIssue id (contenido). */
  githubContentNodeId?: string | null;
  issueNumber?: number | null;
  url?: string | null;
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

export interface ItemFieldValues {
  /** Parent initiative IDs (Task MULTI_SELECT) */
  Task?: string[];
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
  /** Logins asignados (espejo local; también en item.assignees) */
  Assignees?: string[];
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
  /** Sprints locales (también push a fields Sprint/Quarter si existen) */
  sprints?: Sprint[];
  currentQuarter?: CurrentQuarter;
  /** Personas conocidas para asignar (union de assignees + owner) */
  people?: ProjectPerson[];
}

export interface IndexEntry {
  projectId: string;
  number: number;
  title: string;
  owner: string;
  path: string;
  dirty: boolean;
  pulledAt: string | null;
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
} as const;

export const YES_NO_OPTIONS: FieldOption[] = [
  { id: "opt-yes", name: "Sí", color: "RED" },
  { id: "opt-no", name: "No", color: "GREEN" },
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
