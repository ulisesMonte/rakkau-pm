import type { GeneralTask, ProjectDocument, ProjectItem } from "@/lib/types";

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
    const m = u.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/i);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
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

export async function resolveIssueRepositoryId(
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>,
  opts?: { projectId?: string; doc?: ProjectDocument },
): Promise<string> {
  const candidates: string[] = [];
  const envRepo = process.env.GH_ISSUE_REPOSITORY?.trim();
  if (envRepo) candidates.push(envRepo);
  const fromDoc = inferRepositoryFromDocument(opts?.doc);
  if (fromDoc) candidates.push(fromDoc);

  if (opts?.projectId) {
    try {
      type R = {
        node: {
          repositories: { nodes: Array<{ id: string; nameWithOwner: string }> };
        } | null;
      };
      const data = await gql<R>(
        `query ProjectRepos($id: ID!) {
           node(id: $id) {
             ... on ProjectV2 {
               repositories(first: 10) {
                 nodes { id nameWithOwner }
               }
             }
           }
         }`,
        { id: opts.projectId },
      );
      for (const repo of data.node?.repositories?.nodes ?? []) {
        if (repo.nameWithOwner) candidates.push(repo.nameWithOwner);
      }
    } catch {
      /* seguir con otras fuentes */
    }
  }

  const owner = opts?.doc?.owner?.trim();
  if (owner && !candidates.length) {
    try {
      type R = {
        user: {
          repositories: { nodes: Array<{ nameWithOwner: string }> };
        } | null;
      };
      const data = await gql<R>(
        `query OwnerRepos($login: String!) {
           user(login: $login) {
             repositories(first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
               nodes { nameWithOwner }
             }
           }
         }`,
        { login: owner },
      );
      for (const repo of data.user?.repositories?.nodes ?? []) {
        if (repo.nameWithOwner) candidates.push(repo.nameWithOwner);
      }
    } catch {
      /* ignore */
    }
  }

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
    "No se pudo resolver el repo para issues. En .env.local agregá GH_ISSUE_REPOSITORY=owner/repo " +
      "(ej. ulisesMonte/ciam-ops-hybrid-test) o vinculá un repo al Project en GitHub.",
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
    assignees: [],
    Sprint: "",
    Quarter: doc.currentQuarter?.quarter ?? "",
    githubProjectItemNodeId: null,
    githubContentNodeId: null,
    issueNumber: null,
    url: null,
  };
}

/** Separa filas del project: padres → generalTasks, hijos → items (subtareas). */
export function rebuildProjectHierarchyFromGitHub(
  doc: ProjectDocument,
): ProjectDocument {
  const next = structuredClone(doc);
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

    // Otro draft/ítem distinto con el mismo id de negocio → mostrarlo como subtarea (no perder fila)
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
    const itemStatus = item.fieldValues.Status;
    if (typeof itemStatus === "string" && itemStatus.trim()) {
      gt.Status = itemStatus.trim();
    }
    if (item.fieldValues.Blocked) gt.Blocked = item.fieldValues.Blocked;
    if (item.fieldValues.BlockedReason) {
      gt.BlockedReason = item.fieldValues.BlockedReason;
    }
    if (gt.githubContentNodeId) generalByContent.set(gt.githubContentNodeId, gt);
  }

  next.items = subtasks;
  return next;
}
