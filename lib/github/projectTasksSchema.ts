/**
 * Tasks / ítems del board: GitHub Projects v2 ↔ generalTasks + items (subtareas).
 */

import type {
  GeneralTask,
  ItemFieldValues,
  ProjectDocument,
  ProjectField,
  ProjectItem,
} from "@/lib/types";
import { asStringList, firstTaskId } from "@/lib/fieldValueCoerce";
import {
  applyItemFieldValuesToGeneralTask,
  mergeGeneralTaskGithubFieldValues,
} from "@/lib/github/generalTaskFields";
import {
  defaultGeneralTaskFields,
  parseRakkauTaskIdFromBody,
} from "@/lib/github/issueHierarchy";
import { normalizeProjectHierarchy } from "@/lib/github/projectInvariants";

export const PROJECT_TASKS_SCHEMA_VERSION = 1;

export type RakkauTaskRole = "general" | "subtask";

export type GitHubProjectItemContent = {
  __typename?: string;
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  body?: string;
  assignees?: { nodes?: Array<{ login?: string; name?: string | null; avatarUrl?: string | null }> };
  subIssues?: { nodes?: Array<{ id: string }> };
};

export type GitHubProjectItemFieldValueNode = {
  __typename?: string;
  text?: string;
  title?: string;
  number?: number;
  name?: string;
  date?: string;
  users?: { nodes?: Array<{ login?: string }> };
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
    if (content?.body) fieldValues[INTERNAL_BODY_KEY] = content.body;

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
      parentIssueContentId: null,
      assignees,
      blockedBy: [],
      blocks: [],
    };
  });

  const byContent = new Map<string, ProjectItem>();
  for (const item of items) {
    if (item.contentNodeId) byContent.set(item.contentNodeId, item);
  }
  for (const n of nodes) {
    const content = n.content;
    if (content?.__typename !== "Issue" || !content.id) continue;
    for (const sub of content.subIssues?.nodes ?? []) {
      const child = byContent.get(sub.id);
      if (child) child.parentIssueContentId = content.id;
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
    Blocked: local.Blocked ?? remote.Blocked,
    BlockedReason: local.BlockedReason ?? remote.BlockedReason,
    Sprint: local.Sprint ?? remote.Sprint,
    Quarter: local.Quarter ?? remote.Quarter,
    DueDate: local.DueDate ?? remote.DueDate,
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
    links: pushed.links ?? remote.links,
    people: remote.people?.length ? remote.people : pushed.people,
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
