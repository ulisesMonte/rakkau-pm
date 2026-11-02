import type { GeneralTask, ProjectDocument, ProjectItem } from "@/lib/types";
import {
  ensureGeneralTasksForSubtasks,
  rebuildProjectHierarchyFromGitHub,
} from "@/lib/github/issueHierarchy";
import { firstTaskId } from "@/lib/fieldValueCoerce";

export type HierarchyValidation = {
  ok: boolean;
  issues: string[];
};

export function validateProjectHierarchy(doc: ProjectDocument): HierarchyValidation {
  const issues: string[] = [];
  const gtIds = new Set(doc.generalTasks.map((g) => g.id));
  const contentIds = new Map<string, GeneralTask>();
  for (const gt of doc.generalTasks) {
    if (gt.githubContentNodeId) {
      const prev = contentIds.get(gt.githubContentNodeId);
      if (prev && prev.id !== gt.id) {
        issues.push(
          `Dos tareas generales comparten githubContentNodeId ${gt.githubContentNodeId}`,
        );
      }
      contentIds.set(gt.githubContentNodeId, gt);
    }
  }

  for (const item of doc.items) {
    const pid =
      item.parentTaskId?.trim() || firstTaskId(item.fieldValues.Task) || null;
    if (!pid) {
      issues.push(`Subtarea «${item.title}» sin parentTaskId`);
      continue;
    }
    if (!gtIds.has(pid)) {
      issues.push(
        `Subtarea «${item.title}» apunta a padre inexistente «${pid}»`,
      );
    }
    if (item.parentIssueContentId && !contentIds.has(item.parentIssueContentId)) {
      issues.push(
        `Subtarea #${item.number ?? "?"} parentIssueContentId sin GeneralTask`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Reparaciones idempotentes post pull / post push merge. */
export function normalizeProjectHierarchy(doc: ProjectDocument): ProjectDocument {
  let next = structuredClone(doc);
  next = ensureGeneralTasksForSubtasks(next);

  const gtById = new Map(next.generalTasks.map((g) => [g.id, g]));
  for (const item of next.items) {
    const pid =
      item.parentTaskId?.trim() || firstTaskId(item.fieldValues.Task) || null;
    if (pid && !gtById.has(pid) && item.parentIssueContentId) {
      const gt = next.generalTasks.find(
        (g) => g.githubContentNodeId === item.parentIssueContentId,
      );
      if (gt) {
        item.parentTaskId = gt.id;
        if (!item.fieldValues.Task) item.fieldValues.Task = [gt.id];
      }
    }
  }

  return next;
}

export function flattenHierarchyToBoardRows(doc: ProjectDocument): ProjectItem[] {
  const rows: ProjectItem[] = [];
  const seenContent = new Set<string>();

  for (const gt of doc.generalTasks) {
    const nodeId = gt.githubProjectItemNodeId;
    if (!nodeId) continue;
    const contentNodeId = gt.githubContentNodeId ?? null;
    if (contentNodeId) seenContent.add(contentNodeId);
    rows.push({
      nodeId,
      contentNodeId,
      number: gt.issueNumber ?? null,
      title: gt.title,
      state: gt.Status === "CLOSED" ? "CLOSED" : "OPEN",
      url: gt.url ?? null,
      contentType: gt.issueNumber != null ? "Issue" : "DraftIssue",
      fieldValues: generalTaskToFieldValues(gt),
      parentTaskId: null,
      parentIssueContentId: null,
      assignees: gt.assignees ?? [],
      blockedBy: [],
      blocks: [],
    });
  }

  for (const item of doc.items) {
    if (item.contentNodeId && seenContent.has(item.contentNodeId)) continue;
    rows.push(item);
  }

  return rows;
}

function generalTaskToFieldValues(gt: GeneralTask): ProjectItem["fieldValues"] {
  return {
    Title: gt.title,
    Task: [gt.id],
    Status: gt.Status,
    HasDependency: gt.HasDependency,
    DependsOn: gt.DependsOn,
    Blocked: gt.Blocked,
    BlockedReason: gt.BlockedReason,
    Sprint: gt.Sprint,
    Quarter: gt.Quarter,
    DueDate: gt.DueDate,
    Assignees: gt.assignees,
  };
}

export function rebuildFromFlatBoardRows(doc: ProjectDocument): ProjectDocument {
  const flat = flattenHierarchyToBoardRows(doc);
  return normalizeProjectHierarchy(
    rebuildProjectHierarchyFromGitHub({ ...doc, items: flat, generalTasks: [] }),
  );
}
