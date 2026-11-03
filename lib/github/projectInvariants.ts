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

  const itemContentIds = new Set(
    doc.items
      .map((i) => i.contentNodeId)
      .filter((id): id is string => Boolean(id)),
  );

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
    // Padre puede ser GeneralTask raíz u otro ítem mid-level (árbol N-nivel).
    if (
      item.parentIssueContentId &&
      !contentIds.has(item.parentIssueContentId) &&
      !itemContentIds.has(item.parentIssueContentId)
    ) {
      issues.push(
        `Subtarea #${item.number ?? "?"} parentIssueContentId sin padre en board`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

function isSyntheticParentId(id: string): boolean {
  return /^parent-/i.test(id.trim());
}

function isSyntheticGeneralTask(gt: {
  id: string;
  title?: string | null;
}): boolean {
  return (
    isSyntheticParentId(gt.id) || isSyntheticParentId(gt.title ?? "")
  );
}

/** Un contentNodeId → una sola GeneralTask (preferir título real sobre parent-XXXX). */
function dedupeGeneralTasksByContent(doc: ProjectDocument): ProjectDocument {
  const next = structuredClone(doc);
  const byContent = new Map<string, (typeof next.generalTasks)[number]>();
  const kept: typeof next.generalTasks = [];
  const idRemap = new Map<string, string>();

  for (const gt of next.generalTasks) {
    const cid = gt.githubContentNodeId;
    if (!cid) {
      kept.push(gt);
      continue;
    }
    const prev = byContent.get(cid);
    if (!prev) {
      byContent.set(cid, gt);
      kept.push(gt);
      continue;
    }
    // Ya hay una: quedarnos con la no-sintética / mejor título.
    const prevSyn = isSyntheticGeneralTask(prev);
    const curSyn = isSyntheticGeneralTask(gt);
    if (prevSyn && !curSyn) {
      const idx = kept.indexOf(prev);
      if (idx >= 0) kept[idx] = gt;
      byContent.set(cid, gt);
      if (prev.id !== gt.id) idRemap.set(prev.id, gt.id);
    } else if (!prevSyn && curSyn && prev.id !== gt.id) {
      idRemap.set(gt.id, prev.id);
    }
  }

  // Tirar sintéticos huérfanos (sin hijos) o duplicados del issue real.
  const parentContents = new Set(
    next.items
      .map((i) => i.parentIssueContentId)
      .filter((id): id is string => Boolean(id)),
  );
  next.generalTasks = kept.filter((gt) => {
    if (!isSyntheticGeneralTask(gt)) return true;
    if (!gt.githubContentNodeId || !parentContents.has(gt.githubContentNodeId)) {
      return false;
    }
    // Si ya hay canónico no-sintético para el mismo content, no dejar el parent-*.
    const canon = byContent.get(gt.githubContentNodeId);
    if (canon && canon !== gt && !isSyntheticGeneralTask(canon)) {
      if (gt.id !== canon.id) idRemap.set(gt.id, canon.id);
      return false;
    }
    return true;
  });

  // Enriquecer sintéticos restantes con título/número del Issue.parent (Traer).
  for (const gt of next.generalTasks) {
    if (!isSyntheticGeneralTask(gt)) continue;
    const child = next.items.find(
      (i) => i.parentIssueContentId === gt.githubContentNodeId,
    );
    if (!child) continue;
    const realTitle = child.parentIssueTitle?.trim();
    if (realTitle) {
      const oldId = gt.id;
      gt.title = realTitle;
      if (isSyntheticParentId(gt.id)) {
        const clash = next.generalTasks.some(
          (g) =>
            g !== gt &&
            g.id === realTitle &&
            g.githubContentNodeId !== gt.githubContentNodeId,
        );
        gt.id = clash
          ? child.parentIssueNumber != null
            ? `${realTitle} #${child.parentIssueNumber}`
            : `${realTitle} · ${(gt.githubContentNodeId ?? "").slice(-8)}`
          : realTitle;
        if (oldId !== gt.id) idRemap.set(oldId, gt.id);
      }
    }
    if (child.parentIssueNumber != null) {
      gt.issueNumber = child.parentIssueNumber;
    }
  }

  // Reapuntar parentTaskId + Task al GT canónico (por content o remap de id).
  const canon = new Map<string, string>();
  for (const gt of next.generalTasks) {
    if (gt.githubContentNodeId) canon.set(gt.githubContentNodeId, gt.id);
  }
  for (const item of next.items) {
    let id: string | undefined;
    if (item.parentIssueContentId) {
      id = canon.get(item.parentIssueContentId);
    }
    if (!id && item.parentTaskId && idRemap.has(item.parentTaskId)) {
      id = idRemap.get(item.parentTaskId);
    }
    if (!id) continue;
    item.parentTaskId = id;
    item.fieldValues.Task = [id];
  }

  return next;
}

/** Reparaciones idempotentes post pull / post push merge. */
export function normalizeProjectHierarchy(doc: ProjectDocument): ProjectDocument {
  let next = structuredClone(doc);
  next = ensureGeneralTasksForSubtasks(next);
  next = dedupeGeneralTasksByContent(next);

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
