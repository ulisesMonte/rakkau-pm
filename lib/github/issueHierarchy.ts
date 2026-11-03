import type { GeneralTask, ProjectDocument, ProjectItem } from "@/lib/types";
import { applyItemFieldValuesToGeneralTask } from "@/lib/github/generalTaskFields";

const RAKKAU_ID_LINE = /^rakkau-task-id:\s*(.+)\s*$/im;

export function parseRakkauTaskIdFromBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = body.match(RAKKAU_ID_LINE);
  return m?.[1]?.trim() || null;
}

export function generalTaskBody(task: GeneralTask): string {
  const lines = [`rakkau-task-id: ${task.id}`];
  if (task.description?.trim()) lines.push("", task.description.trim());
  return lines.join("\n");
}

export function isLocalGeneralStubId(id: string | undefined | null): boolean {
  if (!id) return true;
  return id.startsWith("local_general_");
}

/** Normaliza y dedupea slugs `owner/repo` (case-insensitive). */
export function uniqueRepositorySlugs(
  ...groups: Array<string | null | undefined | Iterable<string | null | undefined>>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (group == null) continue;
    const list =
      typeof group === "string" ? [group] : Array.from(group as Iterable<string | null | undefined>);
    for (const raw of list) {
      const clean = raw?.trim();
      if (!clean || !clean.includes("/")) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

export function inferRepositoryFromDocument(
  doc: ProjectDocument | undefined,
): string | null {
  if (!doc) return null;
  const urls = [
    ...doc.items.map((i) => i.url),
    ...doc.generalTasks.map((g) => g.url),
  ];
  for (const u of urls) {
    if (!u) continue;
    const m = u.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\/|$)/i);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

export function inferRepositoriesFromDocument(
  doc: ProjectDocument | undefined,
): string[] {
  if (!doc) return [];
  const found: string[] = [];
  const urls = [
    ...doc.items.map((i) => i.url),
    ...doc.generalTasks.map((g) => g.url),
  ];
  for (const u of urls) {
    if (!u) continue;
    const m = u.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\/|$)/i);
    if (m) found.push(`${m[1]}/${m[2]}`);
  }
  return uniqueRepositorySlugs(found);
}

export function envIssueRepositoryFallback(): string | null {
  const v = process.env.GH_ISSUE_REPOSITORY?.trim();
  return v || null;
}

/**
 * Elige default de `issueRepository` sin mutar remoto.
 * Prioridad: selecciÃ³n previa â†’ env â†’ primer disponible â†’ inferido de URLs.
 */
export function pickDefaultIssueRepository(opts: {
  preferred?: string | null;
  available?: string[];
  doc?: ProjectDocument;
}): string | null {
  const preferred = opts.preferred?.trim();
  if (preferred) return preferred;
  const env = envIssueRepositoryFallback();
  if (env) return env;
  const available = opts.available?.length
    ? opts.available
    : opts.doc?.availableRepositories;
  if (available?.[0]) return available[0];
  return inferRepositoryFromDocument(opts.doc);
}

async function repositoryNodeId(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  owner: string,
  name: string,
): Promise<string | null> {
  type R = { repository: { id: string } | null };
  const data = await gql<R>(
    `query Repo($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) { id }
     }`,
    { owner, name },
  );
  return data.repository?.id ?? null;
}

/** Repos vinculados al Project v2 en GitHub. */
export async function fetchProjectLinkedRepositories(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  projectId: string,
): Promise<string[]> {
  type R = {
    node: {
      repositories: { nodes: Array<{ nameWithOwner: string }> };
    } | null;
  };
  const data = await gql<R>(
    `query ProjectRepos($id: ID!) {
       node(id: $id) {
         ... on ProjectV2 {
           repositories(first: 20) {
             nodes { nameWithOwner }
           }
         }
       }
     }`,
    { id: projectId },
  );
  return uniqueRepositorySlugs(
    (data.node?.repositories?.nodes ?? []).map((r) => r.nameWithOwner),
  );
}

async function fetchOwnerRepositories(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  ownerLogin: string,
): Promise<string[]> {
  type R = {
    user: {
      repositories: { nodes: Array<{ nameWithOwner: string }> };
    } | null;
  };
  const data = await gql<R>(
    `query OwnerRepos($login: String!) {
       user(login: $login) {
         repositories(first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
           nodes { nameWithOwner }
         }
       }
     }`,
    { login: ownerLogin },
  );
  return uniqueRepositorySlugs(
    (data.user?.repositories?.nodes ?? []).map((r) => r.nameWithOwner),
  );
}

/**
 * Descubre candidatos a repo de issues: seleccion UI, env, vinculados al Project,
 * URLs de items, y (si hace falta) repos recientes del owner.
 */
export async function discoverIssueRepositories(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  opts?: { projectId?: string; doc?: ProjectDocument },
): Promise<string[]> {
  const linked: string[] = [];
  if (opts?.projectId) {
    try {
      linked.push(...(await fetchProjectLinkedRepositories(gql, opts.projectId)));
    } catch {
      /* seguir */
    }
  }

  const fromItems = inferRepositoriesFromDocument(opts?.doc);
  let ownerRepos: string[] = [];
  const known = uniqueRepositorySlugs(
    opts?.doc?.issueRepository,
    opts?.doc?.availableRepositories,
    envIssueRepositoryFallback(),
    linked,
    fromItems,
  );

  if (!known.length) {
    const owner = opts?.doc?.owner?.trim();
    if (owner) {
      try {
        ownerRepos = await fetchOwnerRepositories(gql, owner);
      } catch {
        /* ignore */
      }
    }
  }

  return uniqueRepositorySlugs(known, ownerRepos);
}

/**
 * Resuelve el node id del repo donde crear issues/sub-issues.
 * Prioridad: `doc.issueRepository` (UI) -> `GH_ISSUE_REPOSITORY` -> discovery.
 */
export async function resolveIssueRepositoryId(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  opts?: { projectId?: string; doc?: ProjectDocument },
): Promise<string> {
  const discovered = await discoverIssueRepositories(gql, opts);
  const candidates = uniqueRepositorySlugs(
    opts?.doc?.issueRepository,
    envIssueRepositoryFallback(),
    opts?.doc?.availableRepositories,
    discovered,
  );

  const seen = new Set<string>();
  for (const slug of candidates) {
    const clean = slug.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    const [o, n] = clean.split("/");
    if (!o || !n) continue;
    const id = await repositoryNodeId(gql, o, n);
    if (id) return id;
  }

  throw new Error(
    "No se pudo resolver el repo para issues. Elegi \"Repo de issues\" en la UI " +
      "(o como fallback GH_ISSUE_REPOSITORY=owner/repo en .env.local) " +
      "o vincula un repositorio al Project en GitHub.",
  );
}

export function defaultGeneralTaskFields(
  doc: ProjectDocument,
  id: string,
  title: string,
): GeneralTask {
  return {
    id,
    title,
    Status: "",
    HasDependency: "No",
    DependsOn: "",
    Blocked: "No",
    BlockedReason: "",
    Responsable: "",
    assignees: [],
    Sprint: "",
    Quarter: doc.currentQuarter?.quarter ?? "",
    githubProjectItemNodeId: null,
    githubContentNodeId: null,
    issueNumber: null,
    url: null,
  };
}

/** Separa filas del project: padres ÔåÆ generalTasks, hijos ÔåÆ items (subtareas). */
export function rebuildProjectHierarchyFromGitHub(
  doc: ProjectDocument,
): ProjectDocument {
  const next = structuredClone(doc);
  const flatByContent = new Map<string, ProjectItem>();
  for (const item of next.items) {
    if (item.contentNodeId) {
      flatByContent.set(item.contentNodeId, item);
    }
  }

  const generalByContent = new Map<string, GeneralTask>();
  for (const gt of next.generalTasks) {
    if (gt.githubContentNodeId) generalByContent.set(gt.githubContentNodeId, gt);
  }

  const subtasks: ProjectItem[] = [];

  for (const item of next.items) {
    if (item.parentIssueContentId) {
      const parentContentId = item.parentIssueContentId;
      const parentGt =
        generalByContent.get(parentContentId) ||
        next.generalTasks.find((g) => g.githubContentNodeId === parentContentId);
      item.parentTaskId = parentGt?.id ?? item.parentTaskId;
      if (parentGt && !item.fieldValues.Task) {
        item.fieldValues.Task = [parentGt.id];
      }
      subtasks.push(item);
      continue;
    }

    const bodyText =
      typeof item.fieldValues._body === "string" ? item.fieldValues._body : undefined;
    const rakkauId = parseRakkauTaskIdFromBody(bodyText);

    // Ya mapeado a esta fila exacta del project
    let gt = next.generalTasks.find(
      (g) =>
        g.githubContentNodeId === item.contentNodeId ||
        g.githubProjectItemNodeId === item.nodeId,
    );

    // Otro draft/├¡tem distinto con el mismo id de negocio ÔåÆ mostrarlo como subtarea (no perder fila)
    if (!gt && rakkauId) {
      const sameBusinessId = next.generalTasks.find((g) => g.id === rakkauId);
      if (
        sameBusinessId?.githubContentNodeId &&
        sameBusinessId.githubContentNodeId !== item.contentNodeId
      ) {
        item.parentTaskId = rakkauId;
        if (!item.fieldValues.Task) item.fieldValues.Task = [rakkauId];
        subtasks.push(item);
        continue;
      }
      if (sameBusinessId && !sameBusinessId.githubContentNodeId) {
        gt = sameBusinessId;
      }
    }

    const taskId = rakkauId || item.title;

    if (!gt) {
      gt = next.generalTasks.find((g) => g.id === taskId && !g.githubContentNodeId);
    }
    if (!gt) {
      gt = defaultGeneralTaskFields(next, taskId, item.title);
      next.generalTasks.push(gt);
    } else if (
      gt.githubContentNodeId &&
      item.contentNodeId &&
      gt.githubContentNodeId !== item.contentNodeId
    ) {
      item.parentTaskId = gt.id;
      if (!item.fieldValues.Task) item.fieldValues.Task = [gt.id];
      subtasks.push(item);
      continue;
    }

    gt.id = rakkauId || gt.id || taskId;
    gt.title = item.title || gt.title;
    gt.githubProjectItemNodeId = item.nodeId;
    gt.githubContentNodeId = item.contentNodeId ?? gt.githubContentNodeId;
    gt.issueNumber = item.number ?? gt.issueNumber;
    gt.url = item.url ?? gt.url;
    Object.assign(gt, applyItemFieldValuesToGeneralTask(gt, item.fieldValues));
    if (gt.githubContentNodeId) generalByContent.set(gt.githubContentNodeId, gt);
  }

  next.items = subtasks;
  return ensureGeneralTasksForSubtasks(next, flatByContent);
}

/** Garantiza GeneralTask para cada subtarea con parentIssueContentId. */
export function ensureGeneralTasksForSubtasks(
  doc: ProjectDocument,
  flatByContent?: Map<string, ProjectItem>,
): ProjectDocument {
  const next = structuredClone(doc);
  const byContent = new Map<string, GeneralTask>();
  for (const gt of next.generalTasks) {
    if (gt.githubContentNodeId) byContent.set(gt.githubContentNodeId, gt);
  }

  for (const item of next.items) {
    const parentContentId = item.parentIssueContentId;
    if (!parentContentId || byContent.has(parentContentId)) continue;

    const parentRow = flatByContent?.get(parentContentId);
    const bodyText =
      typeof parentRow?.fieldValues._body === "string"
        ? parentRow.fieldValues._body
        : undefined;
    const fromBody = parseRakkauTaskIdFromBody(bodyText);
    const fallbackId =
      item.parentTaskId?.trim() ||
      firstTaskIdFromItem(item) ||
      `parent-${parentContentId.slice(-8)}`;
    const id = fromBody || fallbackId;

    let gt = defaultGeneralTaskFields(next, id, parentRow?.title ?? id);
    gt.githubContentNodeId = parentContentId;
    if (parentRow) {
      gt.githubProjectItemNodeId = parentRow.nodeId;
      gt.issueNumber = parentRow.number;
      gt.url = parentRow.url;
      gt = applyItemFieldValuesToGeneralTask(gt, parentRow.fieldValues);
    }
    next.generalTasks.push(gt);
    byContent.set(parentContentId, gt);
    if (!item.parentTaskId) item.parentTaskId = gt.id;
    if (!item.fieldValues.Task) item.fieldValues.Task = [gt.id];
  }

  return next;
}

function firstTaskIdFromItem(item: ProjectItem): string | null {
  const t = item.fieldValues.Task;
  if (Array.isArray(t)) return t[0]?.trim() || null;
  if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}
