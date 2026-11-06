/**
 * Tasks / ítems del board: GitHub Projects v2 ↔ generalTasks + items (subtareas).
 */

import type {
  GeneralTask,
  IssueLabel,
  IssueTypeRef,
  ItemFieldValues,
  ProjectDocument,
  ProjectField,
  ProjectItem,
} from "@/lib/types";
import { asStringList, firstTaskId } from "@/lib/fieldValueCoerce";
import { titleMarksDependency } from "@/lib/dependencyTitle";
import {
  applyItemFieldValuesToGeneralTask,
  mergeGeneralTaskGithubFieldValues,
} from "@/lib/github/generalTaskFields";
import {
  defaultGeneralTaskFields,
  parseRakkauTaskIdFromBody,
} from "@/lib/github/issueHierarchy";
import { normalizeProjectHierarchy } from "@/lib/github/projectInvariants";
import { normalizeResponsableValue } from "@/lib/responsable";

export const PROJECT_TASKS_SCHEMA_VERSION = 1;

export type RakkauTaskRole = "general" | "subtask";

export type GitHubSubIssuesSummary = {
  total?: number | null;
  completed?: number | null;
  percentCompleted?: number | null;
};

export type GitHubProjectItemContent = {
  __typename?: string;
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  body?: string;
  assignees?: { nodes?: Array<{ login?: string; name?: string | null; avatarUrl?: string | null }> };
  labels?: {
    nodes?: Array<{
      id?: string;
      name?: string;
      color?: string | null;
      description?: string | null;
    }>;
  };
  issueType?: {
    id?: string;
    name?: string;
    color?: string | null;
    description?: string | null;
  } | null;
  /** Padre inmediato (Issue.parent) — preferido para árbol N-nivel. */
  parent?: { id?: string; number?: number | null; title?: string | null } | null;
  subIssuesSummary?: GitHubSubIssuesSummary | null;
  subIssues?: { nodes?: Array<{ id: string }> };
};

function pushLabel(
  out: IssueLabel[],
  seen: Set<string>,
  raw: { name?: string; color?: string | null; description?: string | null },
) {
  const name = raw.name?.trim();
  if (!name) return;
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    name,
    color: raw.color ?? undefined,
    description: raw.description ?? null,
  });
}

/** Labels del Issue + del field Labels del Project (dedupe por nombre). */
function mapMergedLabels(
  content: GitHubProjectItemContent | null | undefined,
  fieldNodes: GitHubProjectItemFieldValueNode[],
): IssueLabel[] {
  const out: IssueLabel[] = [];
  const seen = new Set<string>();
  if (content?.__typename === "Issue") {
    for (const n of content.labels?.nodes ?? []) pushLabel(out, seen, n);
  }
  for (const fv of fieldNodes) {
    if (fv.__typename !== "ProjectV2ItemFieldLabelValue") continue;
    for (const n of fv.labels?.nodes ?? []) pushLabel(out, seen, n);
  }
  return out;
}

function mapIssueType(
  content: GitHubProjectItemContent | null | undefined,
): IssueTypeRef | null {
  if (content?.__typename !== "Issue") return null;
  const t = content.issueType;
  const name = t?.name?.trim();
  if (!name) return null;
  return {
    id: t?.id,
    name,
    color: t?.color ?? null,
    description: t?.description ?? null,
  };
}

export type GitHubProjectItemFieldValueNode = {
  __typename?: string;
  text?: string;
  title?: string;
  number?: number;
  name?: string;
  date?: string;
  users?: { nodes?: Array<{ login?: string }> };
  labels?: {
    nodes?: Array<{
      id?: string;
      name?: string;
      color?: string | null;
      description?: string | null;
    }>;
  };
  field?: { id?: string; name?: string };
};

export type GitHubProjectItemNode = {
  id: string;
  content: GitHubProjectItemContent | null;
  fieldValues: { nodes?: GitHubProjectItemFieldValueNode[] };
};

export type ParsedBoardRow = {
  role: RakkauTaskRole;
  item: ProjectItem;
  rakkauBusinessId: string | null;
};

const INTERNAL_BODY_KEY = "_body";

export function mapGitHubItemFieldValues(
  nodes: GitHubProjectItemFieldValueNode[],
  _catalog?: ProjectField[],
): ItemFieldValues {
  const values: ItemFieldValues = {};
  for (const n of nodes) {
    const name = n.field?.name;
    if (!name) continue;
    if (n.__typename === "ProjectV2ItemFieldTextValue" && n.text != null) {
      values[name] = n.text;
      if (name === "Title") values.Title = n.text;
    } else if (
      n.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
      n.name != null
    ) {
      values[name] = n.name;
    } else if (n.__typename === "ProjectV2ItemFieldIterationValue" && n.title != null) {
      values[name] = n.title;
    } else if (
      n.__typename === "ProjectV2ItemFieldNumberValue" &&
      n.number != null
    ) {
      values[name] = String(n.number);
    } else if (n.__typename === "ProjectV2ItemFieldDateValue" && n.date) {
      values[name] = n.date;
    } else if (n.__typename === "ProjectV2ItemFieldUserValue") {
      const logins =
        n.users?.nodes
          ?.map((u) => u.login)
          .filter((login): login is string => Boolean(login)) ?? [];
      if (logins.length) values[name] = logins;
    }
  }
  return values;
}

function collectAssigneesFromContent(
  content: GitHubProjectItemContent | null | undefined,
  fieldValues: ItemFieldValues,
): string[] {
  const fromIssue =
    content?.assignees?.nodes
      ?.map((u) => u.login)
      .filter((login): login is string => Boolean(login)) ?? [];
  return Array.from(new Set([...fromIssue, ...asStringList(fieldValues.Assignees)]));
}

export function mapGitHubProjectItems(
  nodes: GitHubProjectItemNode[],
  catalog?: ProjectField[],
): ProjectItem[] {
  void catalog;
  const items = nodes.map((n) => {
    const fieldValues = mapGitHubItemFieldValues(n.fieldValues?.nodes ?? [], catalog);
    if (
      fieldValues.HasDependency == null &&
      typeof fieldValues.DependsOn === "string" &&
      fieldValues.DependsOn.trim()
    ) {
      fieldValues.HasDependency = "Sí";
    }
    if (typeof fieldValues.Responsable === "string") {
      fieldValues.Responsable = normalizeResponsableValue(fieldValues.Responsable);
    }
    const parentTaskId = firstTaskId(fieldValues.Task);
    const content = n.content;
    let contentType: ProjectItem["contentType"] = "Unknown";
    if (content?.__typename === "Issue") contentType = "Issue";
    else if (content?.__typename === "DraftIssue") contentType = "DraftIssue";
    else if (content?.__typename === "PullRequest") contentType = "PullRequest";
    const rawState =
      contentType === "DraftIssue" ? "OPEN" : (content?.state ?? "OPEN");

    const assignees = collectAssigneesFromContent(content, fieldValues);
    if (assignees.length) fieldValues.Assignees = assignees;

    const fromContent = content?.title?.trim() ?? "";
    const fromTitleField =
      typeof fieldValues.Title === "string" ? fieldValues.Title.trim() : "";
    const resolvedTitle = fromContent || fromTitleField || "(sin título)";
    if (fromTitleField && !fieldValues.Title) fieldValues.Title = fromTitleField;
    if (resolvedTitle !== "(sin título)" && !fieldValues.Title) {
      fieldValues.Title = resolvedTitle;
    }
    const isDependency = titleMarksDependency(resolvedTitle);
    if (isDependency && fieldValues.HasDependency !== "Sí") {
      fieldValues.HasDependency = "Sí";
    }
    if (content?.body) fieldValues[INTERNAL_BODY_KEY] = content.body;

    const summaryRaw = content?.subIssuesSummary;
    const subIssuesSummary =
      summaryRaw && typeof summaryRaw.total === "number" && summaryRaw.total > 0
        ? {
            total: summaryRaw.total,
            completed: summaryRaw.completed ?? 0,
            percentCompleted:
              typeof summaryRaw.percentCompleted === "number"
                ? summaryRaw.percentCompleted
                : Math.round(
                    ((summaryRaw.completed ?? 0) / summaryRaw.total) * 100,
                  ),
          }
        : summaryRaw && typeof summaryRaw.total === "number"
          ? {
              total: 0,
              completed: 0,
              percentCompleted: 0,
            }
          : null;

    const parentFromApi =
      content?.__typename === "Issue" && content.parent?.id
        ? content.parent.id
        : null;
    const parentIssueTitle =
      content?.__typename === "Issue" && content.parent?.title?.trim()
        ? content.parent.title.trim()
        : null;
    const parentIssueNumber =
      content?.__typename === "Issue" &&
      typeof content.parent?.number === "number"
        ? content.parent.number
        : null;

    return {
      nodeId: n.id,
      contentNodeId: content?.id ?? null,
      number: content?.number ?? null,
      title: resolvedTitle,
      state: rawState as ProjectItem["state"],
      url: content?.url ?? null,
      contentType,
      fieldValues,
      parentTaskId,
      parentIssueContentId: parentFromApi,
      parentIssueTitle,
      parentIssueNumber,
      subIssuesSummary,
      labels: mapMergedLabels(content, n.fieldValues?.nodes ?? []),
      issueType: mapIssueType(content),
      isDependency: isDependency || undefined,
      assignees,
      blockedBy: [],
      blocks: [],
    };
  });

  const byContent = new Map<string, ProjectItem>();
  for (const item of items) {
    if (item.contentNodeId) byContent.set(item.contentNodeId, item);
  }
  // Completar/corroborar padres vía subIssues del issue en el board.
  for (const n of nodes) {
    const content = n.content;
    if (content?.__typename !== "Issue" || !content.id) continue;
    for (const sub of content.subIssues?.nodes ?? []) {
      const child = byContent.get(sub.id);
      if (!child) continue;
      // parent { id } gana; subIssues rellena huecos.
      if (!child.parentIssueContentId) {
        child.parentIssueContentId = content.id;
      }
    }
  }
  return items;
}

function mergeGeneralTaskPlanning(remote: GeneralTask, local: GeneralTask): GeneralTask {
  const githubFieldValues = mergeGeneralTaskGithubFieldValues(remote, local);
  return {
    ...remote,
    title: local.title?.trim() ? local.title : remote.title,
    description: local.description ?? remote.description,
    Status: local.Status ?? remote.Status,
    HasDependency: local.HasDependency ?? remote.HasDependency,
    DependsOn: local.DependsOn ?? remote.DependsOn,
    isDependency: local.isDependency ?? remote.isDependency,
    Blocked: local.Blocked ?? remote.Blocked,
    BlockedReason: local.BlockedReason ?? remote.BlockedReason,
    Sprint: local.Sprint ?? remote.Sprint,
    Quarter: local.Quarter ?? remote.Quarter,
    DueDate: local.DueDate ?? remote.DueDate,
    Responsable: normalizeResponsableValue(
      local.Responsable ?? remote.Responsable,
    ),
    EstadoOperativo: local.EstadoOperativo ?? remote.EstadoOperativo,
    assignees: local.assignees?.length ? local.assignees : remote.assignees,
    id: local.id || remote.id,
    ...(githubFieldValues ? { githubFieldValues } : {}),
  };
}

/** Tras push: conservar generalTasks remotos y enriquecer con planificación local. */
export function mergeTasksAfterPush(
  pushed: ProjectDocument,
  remote: ProjectDocument,
): ProjectDocument {
  const localGtByContent = new Map<string, GeneralTask>();
  const localGtById = new Map<string, GeneralTask>();
  for (const gt of pushed.generalTasks) {
    localGtById.set(gt.id, gt);
    if (gt.githubContentNodeId) localGtByContent.set(gt.githubContentNodeId, gt);
  }

  const generalTasks: GeneralTask[] = remote.generalTasks.map((rg) => {
    const loc =
      (rg.githubContentNodeId && localGtByContent.get(rg.githubContentNodeId)) ||
      localGtById.get(rg.id);
    return loc ? mergeGeneralTaskPlanning(rg, loc) : rg;
  });

  for (const lg of pushed.generalTasks) {
    if (lg.githubContentNodeId) {
      if (generalTasks.some((g) => g.githubContentNodeId === lg.githubContentNodeId)) {
        continue;
      }
    } else if (generalTasks.some((g) => g.id === lg.id)) {
      continue;
    }
    if (lg.githubProjectItemNodeId && !String(lg.githubProjectItemNodeId).startsWith("local_")) {
      generalTasks.push(lg);
    }
  }

  const localByContent = new Map<string, ProjectItem>();
  const localByNode = new Map<string, ProjectItem>();
  for (const item of pushed.items) {
    if (item.contentNodeId) localByContent.set(item.contentNodeId, item);
    localByNode.set(item.nodeId, item);
  }

  const items: ProjectItem[] = remote.items.map((ri) => {
    const loc =
      (ri.contentNodeId && localByContent.get(ri.contentNodeId)) ||
      localByNode.get(ri.nodeId);
    if (!loc) return ri;
    return {
      ...ri,
      parentTaskId: loc.parentTaskId ?? ri.parentTaskId,
      parentIssueContentId: loc.parentIssueContentId ?? ri.parentIssueContentId,
      assignees: loc.assignees?.length ? loc.assignees : ri.assignees,
      fieldValues: { ...ri.fieldValues, ...loc.fieldValues },
    };
  });

  return normalizeProjectHierarchy({
    ...remote,
    generalTasks,
    items,
    sprints: pushed.sprints?.length ? pushed.sprints : remote.sprints,
    currentQuarter: pushed.currentQuarter ?? remote.currentQuarter,
    macroTasks: pushed.macroTasks ?? remote.macroTasks,
    links: pushed.links ?? remote.links,
    people: remote.people?.length ? remote.people : pushed.people,
    issueRepository: pushed.issueRepository ?? remote.issueRepository,
    availableRepositories:
      pushed.availableRepositories ?? remote.availableRepositories,
    tasksSchemaVersion: PROJECT_TASKS_SCHEMA_VERSION,
  });
}

/** @deprecated Prefer applyItemFieldValuesToGeneralTask from generalTaskFields */
export function applyFieldValuesToGeneralTask(
  gt: GeneralTask,
  fv: ItemFieldValues,
): GeneralTask {
  return applyItemFieldValuesToGeneralTask(gt, fv);
}

export function synthesizeGeneralTaskFromBoardRow(
  doc: ProjectDocument,
  parentContentId: string,
  parentRow: ProjectItem | undefined,
  fallbackBusinessId: string,
): GeneralTask {
  const bodyText =
    typeof parentRow?.fieldValues[INTERNAL_BODY_KEY] === "string"
      ? parentRow.fieldValues[INTERNAL_BODY_KEY]
      : undefined;
  const fromBody = parseRakkauTaskIdFromBody(bodyText);
  const id = fromBody || fallbackBusinessId;
  let gt = defaultGeneralTaskFields(doc, id, parentRow?.title ?? id);
  gt.githubContentNodeId = parentContentId;
  if (parentRow) {
    gt.githubProjectItemNodeId = parentRow.nodeId;
    gt.issueNumber = parentRow.number;
    gt.url = parentRow.url;
    gt = applyFieldValuesToGeneralTask(gt, parentRow.fieldValues);
  }
  return gt;
}
