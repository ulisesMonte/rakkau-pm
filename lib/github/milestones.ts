/**
 * Sprint → GitHub Milestone publish helpers.
 * Creates/updates a milestone per repo and assigns issues that belong to the sprint.
 */

import type { ProjectDocument, ProjectItem, Sprint } from "@/lib/types";

export type GqlFn = <T>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

export type MilestoneRef = {
  id: string;
  number: number;
  title: string;
  dueOn?: string | null;
  state?: string | null;
  repository?: string | null;
};

export type PublishSprintResult = {
  sprint: Sprint;
  milestones: MilestoneRef[];
  assignedIssueIds: string[];
  clearedIssueIds: string[];
  warnings: string[];
};

const CREATE_MILESTONE = `
mutation CreateMilestone($repositoryId: ID!, $title: String!, $dueOn: DateTime, $description: String) {
  createMilestone(input: {
    repositoryId: $repositoryId
    title: $title
    dueOn: $dueOn
    description: $description
  }) {
    milestone { id number title dueOn state }
  }
}
`;

const UPDATE_MILESTONE = `
mutation UpdateMilestone($milestoneId: ID!, $title: String, $dueOn: DateTime, $description: String, $state: MilestoneState) {
  updateMilestone(input: {
    id: $milestoneId
    title: $title
    dueOn: $dueOn
    description: $description
    state: $state
  }) {
    milestone { id number title dueOn state }
  }
}
`;

const UPDATE_ISSUE_MILESTONE = `
mutation UpdateIssueMilestone($id: ID!, $milestoneId: ID) {
  updateIssue(input: { id: $id, milestoneId: $milestoneId }) {
    issue { id milestone { id number title } }
  }
}
`;

const REPO_MILESTONES = `
query RepoMilestones($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    milestones(first: 100, states: OPEN) {
      nodes { id number title dueOn state }
    }
  }
}
`;

const REPO_MILESTONES_CLOSED = `
query RepoMilestonesClosed($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    milestones(first: 50, states: CLOSED) {
      nodes { id number title dueOn state }
    }
  }
}
`;

function dueOnIso(endDate?: string): string | null {
  if (!endDate?.trim()) return null;
  // GitHub expects DateTime; noon UTC avoids off-by-one on date-only.
  return `${endDate.trim().slice(0, 10)}T12:00:00Z`;
}

function sprintDescription(sprint: Sprint): string {
  const parts = [
    `rakkau-sprint-id: ${sprint.id}`,
    `quarter: ${sprint.quarter} ${sprint.year}`,
    `status: ${sprint.status}`,
  ];
  if (sprint.startDate) parts.push(`start: ${sprint.startDate}`);
  if (sprint.endDate) parts.push(`end: ${sprint.endDate}`);
  return parts.join("\n");
}

function normTitle(t: string): string {
  return t.trim().toLowerCase();
}

/** Issues (and generalTasks content) whose Sprint field matches the sprint name. */
export function collectSprintIssueTargets(
  doc: ProjectDocument,
  sprint: Sprint,
): Array<{
  contentNodeId: string;
  repository: string | null;
  sprintField: string;
}> {
  const want = normTitle(sprint.name);
  const out: Array<{
    contentNodeId: string;
    repository: string | null;
    sprintField: string;
  }> = [];
  const seen = new Set<string>();

  const push = (
    contentNodeId: string | null | undefined,
    sprintField: string | undefined,
    repository: string | null | undefined,
  ) => {
    if (!contentNodeId || !sprintField?.trim()) return;
    if (normTitle(sprintField) !== want) return;
    if (seen.has(contentNodeId)) return;
    seen.add(contentNodeId);
    out.push({
      contentNodeId,
      repository: repository?.trim() || null,
      sprintField,
    });
  };

  for (const item of doc.items) {
    push(
      item.contentNodeId,
      typeof item.fieldValues.Sprint === "string"
        ? item.fieldValues.Sprint
        : undefined,
      item.repository ?? null,
    );
  }
  for (const gt of doc.generalTasks) {
    push(gt.githubContentNodeId, gt.Sprint, gt.repository ?? null);
  }
  return out;
}

async function listRepoMilestones(
  gql: GqlFn,
  owner: string,
  name: string,
): Promise<{ repositoryId: string; nameWithOwner: string; nodes: MilestoneRef[] }> {
  type R = {
    repository: {
      id: string;
      nameWithOwner: string;
      milestones: { nodes: MilestoneRef[] };
    } | null;
  };
  const open = await gql<R>(REPO_MILESTONES, { owner, name });
  if (!open.repository) {
    throw new Error(`Repo ${owner}/${name} no encontrado`);
  }
  const closed = await gql<{
    repository: { milestones: { nodes: MilestoneRef[] } } | null;
  }>(REPO_MILESTONES_CLOSED, { owner, name });
  const nodes = [
    ...(open.repository.milestones?.nodes ?? []),
    ...(closed.repository?.milestones?.nodes ?? []),
  ].map((m) => ({
    ...m,
    repository: open.repository!.nameWithOwner,
  }));
  return {
    repositoryId: open.repository.id,
    nameWithOwner: open.repository.nameWithOwner,
    nodes,
  };
}

async function createMilestoneRest(
  owner: string,
  name: string,
  opts: { title: string; description: string; dueOn: string | null },
): Promise<MilestoneRef> {
  const token =
    process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  if (!token) throw new Error("GH_TOKEN requerido para createMilestone REST");
  const body: Record<string, string> = {
    title: opts.title,
    description: opts.description,
    state: "open",
  };
  if (opts.dueOn) body.due_on = opts.dueOn;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/milestones`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "rakkau-ops-platform",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json()) as {
    node_id?: string;
    id?: number;
    number?: number;
    title?: string;
    due_on?: string | null;
    state?: string;
    message?: string;
  };
  if (!res.ok || !json.node_id) {
    throw new Error(json.message || `REST createMilestone HTTP ${res.status}`);
  }
  return {
    id: json.node_id,
    number: json.number ?? 0,
    title: json.title ?? opts.title,
    dueOn: json.due_on ?? opts.dueOn,
    state: json.state ?? "OPEN",
    repository: `${owner}/${name}`,
  };
}

async function ensureMilestone(
  gql: GqlFn,
  opts: {
    owner: string;
    name: string;
    sprint: Sprint;
    existingId?: string | null;
  },
): Promise<MilestoneRef> {
  const { repositoryId, nameWithOwner, nodes } = await listRepoMilestones(
    gql,
    opts.owner,
    opts.name,
  );
  const dueOn = dueOnIso(opts.sprint.endDate);
  const description = sprintDescription(opts.sprint);
  const title = opts.sprint.name.trim();

  const byId = opts.existingId
    ? nodes.find((m) => m.id === opts.existingId)
    : undefined;
  const byTitle = nodes.find((m) => normTitle(m.title) === normTitle(title));
  const existing = byId ?? byTitle;

  if (existing) {
    type U = {
      updateMilestone: { milestone: MilestoneRef };
    };
    const state =
      opts.sprint.status === "done" ? ("CLOSED" as const) : ("OPEN" as const);
    const updated = await gql<U>(UPDATE_MILESTONE, {
      milestoneId: existing.id,
      title,
      dueOn,
      description,
      state,
    });
    return {
      ...updated.updateMilestone.milestone,
      repository: nameWithOwner,
    };
  }

  try {
    type C = {
      createMilestone: { milestone: MilestoneRef };
    };
    const created = await gql<C>(CREATE_MILESTONE, {
      repositoryId,
      title,
      dueOn,
      description,
    });
    return {
      ...created.createMilestone.milestone,
      repository: nameWithOwner,
    };
  } catch {
    // GraphQL createMilestone may be unavailable; fall back to REST.
    return createMilestoneRest(opts.owner, opts.name, {
      title,
      description,
      dueOn,
    });
  }
}
async function assignMilestone(
  gql: GqlFn,
  issueId: string,
  milestoneId: string | null,
): Promise<void> {
  await gql(UPDATE_ISSUE_MILESTONE, { id: issueId, milestoneId });
}

function parseOwnerRepo(slug: string): { owner: string; name: string } | null {
  const [owner, name] = slug.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

/**
 * Publish one sprint as GitHub milestones (one per repo of matching issues)
 * and assign those issues to the milestone. Clears milestone on issues that
 * previously had this sprint's milestone but no longer match.
 */
export async function publishSprintAsMilestones(
  gql: GqlFn,
  doc: ProjectDocument,
  sprint: Sprint,
  opts?: { defaultRepository?: string | null },
): Promise<PublishSprintResult> {
  const warnings: string[] = [];
  const targets = collectSprintIssueTargets(doc, sprint);
  const defaultRepo =
    opts?.defaultRepository?.trim() ||
    doc.issueRepository?.trim() ||
    doc.availableRepositories?.[0]?.trim() ||
    null;

  if (!targets.length && !defaultRepo) {
    return {
      sprint,
      milestones: [],
      assignedIssueIds: [],
      clearedIssueIds: [],
      warnings: [
        "No hay issues con este Sprint ni repo por defecto para crear el milestone.",
      ],
    };
  }

  // Group targets by repo
  const byRepo = new Map<string, typeof targets>();
  for (const t of targets) {
    const repo = t.repository || defaultRepo;
    if (!repo) {
      warnings.push(
        `Issue ${t.contentNodeId}: sin repository; se omite (elegí Repo de issues).`,
      );
      continue;
    }
    const list = byRepo.get(repo) ?? [];
    list.push({ ...t, repository: repo });
    byRepo.set(repo, list);
  }

  // Ensure at least one milestone in default repo when no issues yet
  if (!byRepo.size && defaultRepo) {
    byRepo.set(defaultRepo, []);
  }

  const milestones: MilestoneRef[] = [];
  const milestoneIdsByRepo: Record<string, string> = {
    ...(sprint.githubMilestoneIdsByRepo ?? {}),
  };
  const assignedIssueIds: string[] = [];

  for (const [repo, issues] of byRepo) {
    const parsed = parseOwnerRepo(repo);
    if (!parsed) {
      warnings.push(`Repo inválido: ${repo}`);
      continue;
    }
    try {
      const ms = await ensureMilestone(gql, {
        owner: parsed.owner,
        name: parsed.name,
        sprint,
        existingId: milestoneIdsByRepo[repo] ?? null,
      });
      milestones.push(ms);
      milestoneIdsByRepo[repo] = ms.id;
      for (const issue of issues) {
        try {
          await assignMilestone(gql, issue.contentNodeId, ms.id);
          assignedIssueIds.push(issue.contentNodeId);
        } catch (e) {
          warnings.push(
            `No se pudo asignar milestone a ${issue.contentNodeId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    } catch (e) {
      warnings.push(
        `Milestone en ${repo}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Clear milestone from issues that still point at our old milestone ids but
  // no longer have this Sprint field (best-effort).
  const clearedIssueIds: string[] = [];
  const ourMilestoneIds = new Set(Object.values(milestoneIdsByRepo));
  const stillAssigned = new Set(assignedIssueIds);
  const candidates: ProjectItem[] = doc.items.filter(
    (i) =>
      i.contentNodeId &&
      i.milestoneId &&
      ourMilestoneIds.has(i.milestoneId) &&
      !stillAssigned.has(i.contentNodeId),
  );
  for (const item of candidates) {
    try {
      await assignMilestone(gql, item.contentNodeId!, null);
      clearedIssueIds.push(item.contentNodeId!);
    } catch (e) {
      warnings.push(
        `No se pudo limpiar milestone de ${item.contentNodeId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  const nextSprint: Sprint = {
    ...sprint,
    githubMilestoneIdsByRepo: milestoneIdsByRepo,
    publishedAt: new Date().toISOString(),
  };

  return {
    sprint: nextSprint,
    milestones,
    assignedIssueIds,
    clearedIssueIds,
    warnings,
  };
}

/**
 * Rehydrate local sprints from issue milestones found on Traer.
 * Merges by milestone title; does not delete existing local sprints.
 */
export function mergeSprintsFromMilestones(
  existing: Sprint[] | undefined,
  items: ProjectItem[],
  generalTasks: ProjectDocument["generalTasks"],
): Sprint[] {
  const byName = new Map<string, Sprint>();
  for (const s of existing ?? []) {
    byName.set(normTitle(s.name), { ...s });
  }

  type MsHit = {
    title: string;
    dueOn?: string | null;
    id: string;
    repository?: string | null;
  };
  const hits: MsHit[] = [];
  for (const item of items) {
    if (!item.milestoneTitle || !item.milestoneId) continue;
    hits.push({
      title: item.milestoneTitle,
      dueOn: item.milestoneDueOn,
      id: item.milestoneId,
      repository: item.repository,
    });
  }
  for (const gt of generalTasks) {
    if (!gt.milestoneTitle || !gt.milestoneId) continue;
    hits.push({
      title: gt.milestoneTitle,
      dueOn: gt.milestoneDueOn,
      id: gt.milestoneId,
      repository: gt.repository,
    });
  }

  for (const hit of hits) {
    const key = normTitle(hit.title);
    const prev = byName.get(key);
    const endDate = hit.dueOn?.slice(0, 10);
    const repoMap = { ...(prev?.githubMilestoneIdsByRepo ?? {}) };
    if (hit.repository) repoMap[hit.repository] = hit.id;

    if (prev) {
      byName.set(key, {
        ...prev,
        endDate: prev.endDate || endDate,
        githubMilestoneIdsByRepo: Object.keys(repoMap).length
          ? repoMap
          : prev.githubMilestoneIdsByRepo,
      });
    } else {
      const year = endDate
        ? Number(endDate.slice(0, 4))
        : new Date().getFullYear();
      const month = endDate ? Number(endDate.slice(5, 7)) : 1;
      const q = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
      byName.set(key, {
        id: `sp-ms-${hit.id}`,
        name: hit.title,
        quarter: `Q${q}` as Sprint["quarter"],
        year,
        status: "planned",
        endDate,
        githubMilestoneIdsByRepo: hit.repository
          ? { [hit.repository]: hit.id }
          : { _unknown: hit.id },
      });
    }
  }

  return Array.from(byName.values());
}
