/**
 * GitHub Projects V2 GraphQL client.
 * PAT from `.env.local` / `.env` → process.env.GH_TOKEN — never persisted to JSON.
 */

import type {
  FieldDataType,
  FieldOption,
  GeneralTask,
  GitHubProjectSummary,
  ItemFieldValues,
  ProjectDocument,
  ProjectField,
  ProjectItem,
} from "@/lib/types";
import {
  BLOCKED_OPTIONS,
  CANONICAL_FIELDS,
  RESPONSABLE_OPTIONS,
  YES_NO_OPTIONS,
  currentCalendarQuarter,
} from "@/lib/types";
import { itemTitleForSync } from "@/lib/itemTitle";
import { issueStateFromProjectStatus } from "@/lib/taskStatus";
import {
  generalTaskBody,
  inferRepositoriesFromDocument,
  pickDefaultIssueRepository,
  rebuildProjectHierarchyFromGitHub,
  resolveIssueRepositoryId,
  uniqueRepositorySlugs,
} from "@/lib/github/issueHierarchy";
import {
  canonicalFieldsCreateSpecs,
  mapGitHubProjectFields,
  mergeGitHubFieldCatalog,
  PROJECT_FIELDS_SCHEMA_VERSION,
  type GitHubProjectFieldNode,
} from "@/lib/github/projectFieldsSchema";
import { ensureAllUiFieldsOnGitHub } from "@/lib/github/fieldProvisioning";
import { normalizeProjectHierarchy } from "@/lib/github/projectInvariants";
import {
  mapGitHubProjectItems,
  mergeTasksAfterPush,
  PROJECT_TASKS_SCHEMA_VERSION,
  type GitHubProjectItemNode,
} from "@/lib/github/projectTasksSchema";
import { asStringList } from "@/lib/fieldValueCoerce";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

export class GitHubGraphQLError extends Error {
  constructor(
    message: string,
    public status?: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "GitHubGraphQLError";
  }
}

export function getToken(): string | null {
  // Next carga `.env`, `.env.local`, `.env.development` automáticamente.
  const t =
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    null;
  return t || null;
}

export function hasToken(): boolean {
  return Boolean(getToken());
}

async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new GitHubGraphQLError(
      "GH_TOKEN no configurado. Modo offline: usá el fixture demo.",
      401,
    );
  }

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "rakkau-ops-platform",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (!res.ok) {
    throw new GitHubGraphQLError(
      `GitHub HTTP ${res.status}`,
      res.status,
      body,
    );
  }
  if (body.errors?.length) {
    throw new GitHubGraphQLError(
      body.errors.map((e) => e.message).join("; "),
      res.status,
      body.errors,
    );
  }
  if (!body.data) {
    throw new GitHubGraphQLError("Respuesta GraphQL sin data", res.status, body);
  }
  return body.data;
}

/* ---------- Queries ---------- */

const LIST_PROJECTS = `
query ListProjects($first: Int!) {
  viewer {
    login
    projectsV2(first: $first) {
      nodes {
        id
        number
        title
        url
        owner { __typename ... on User { login } ... on Organization { login } }
        repositories(first: 20) {
          nodes { nameWithOwner }
        }
      }
    }
  }
}
`;

const PULL_PROJECT = `
query PullProject($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      id
      number
      title
      url
      owner { __typename ... on User { login } ... on Organization { login } }
      repositories(first: 20) {
        nodes { nameWithOwner }
      }
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2Field {
            id name dataType
          }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name color description }
          }
          ... on ProjectV2IterationField {
            id name dataType
          }
        }
      }
      items(first: 100) {
        nodes {
          id
          content {
            __typename
            ... on Issue {
              id
              number title url state body
              assignees(first: 10) {
                nodes { login name avatarUrl }
              }
              subIssues(first: 50) {
                nodes { id }
              }
            }
            ... on DraftIssue {
              id title body
              assignees(first: 10) {
                nodes { login name avatarUrl }
              }
            }
            ... on PullRequest {
              number title url state
              assignees(first: 10) {
                nodes { login name avatarUrl }
              }
            }
          }
          fieldValues(first: 80) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { id name } }
              }
              ... on ProjectV2ItemFieldUserValue {
                users(first: 10) { nodes { login name avatarUrl } }
                field { ... on ProjectV2FieldCommon { id name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

const CREATE_FIELD = `
mutation CreateField($input: CreateProjectV2FieldInput!) {
  createProjectV2Field(input: $input) {
    projectV2Field {
      ... on ProjectV2Field { id name dataType }
      ... on ProjectV2SingleSelectField {
        id name dataType
        options { id name color }
      }
    }
  }
}
`;

const UPDATE_FIELD_VALUE = `
mutation UpdateFieldValue($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) {
    projectV2Item { id }
  }
}
`;

const ADD_DRAFT_ISSUE = `
mutation AddDraftIssue($input: AddProjectV2DraftIssueInput!) {
  addProjectV2DraftIssue(input: $input) {
    projectItem {
      id
      content {
        __typename
        ... on DraftIssue { id title }
      }
    }
  }
}
`;

const CONVERT_DRAFT_TO_ISSUE = `
mutation ConvertDraft($input: ConvertProjectV2DraftIssueItemToIssueInput!) {
  convertProjectV2DraftIssueItemToIssue(input: $input) {
    item {
      id
      content {
        __typename
        ... on Issue { id number title url state }
      }
    }
  }
}
`;

const ADD_SUB_ISSUE = `
mutation AddSubIssue($input: AddSubIssueInput!) {
  addSubIssue(input: $input) {
    issue { id }
    subIssue { id number title url state }
  }
}
`;

const UPDATE_PROJECT_FIELD = `
mutation UpdateProjectField($input: UpdateProjectV2FieldInput!) {
  updateProjectV2Field(input: $input) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id name dataType
        options { id name color description }
      }
    }
  }
}
`;

/* ---------- Public API ---------- */

export async function listProjects(): Promise<GitHubProjectSummary[]> {
  type R = {
    viewer: {
      login: string;
      projectsV2: {
        nodes: Array<{
          id: string;
          number: number;
          title: string;
          url: string;
          owner: { login?: string };
          repositories?: { nodes: Array<{ nameWithOwner: string }> };
        }>;
      };
    };
  };
  const data = await gql<R>(LIST_PROJECTS, { first: 40 });
  return data.viewer.projectsV2.nodes.map((n) => ({
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    owner: n.owner?.login ?? data.viewer.login,
    repositories: uniqueRepositorySlugs(
      (n.repositories?.nodes ?? []).map((r) => r.nameWithOwner),
    ),
  }));
}

interface RawFieldNode extends GitHubProjectFieldNode {}

interface RawPerson {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface RawFieldValueNode {
  __typename?: string;
  text?: string;
  title?: string;
  number?: number;
  name?: string;
  optionId?: string;
  date?: string;
  value?: string | string[];
  options?: Array<{ id: string; name: string }>;
  users?: { nodes?: RawPerson[] };
  field?: { id?: string; name?: string };
}

interface RawItemNode extends GitHubProjectItemNode {
  fieldValues: { nodes: RawFieldValueNode[] };
}

function mapFields(nodes: RawFieldNode[]): ProjectField[] {
  return mapGitHubProjectFields(nodes);
}

function mapItems(nodes: RawItemNode[], catalog?: ProjectField[]): ProjectItem[] {
  return mapGitHubProjectItems(nodes, catalog);
}

function derivePeople(
  owner: string,
  items: ProjectItem[],
  nodes: RawItemNode[],
): import("@/lib/types").ProjectPerson[] {
  const map = new Map<string, import("@/lib/types").ProjectPerson>();
  if (owner) map.set(owner, { login: owner });
  for (const n of nodes) {
    for (const u of n.content?.assignees?.nodes ?? []) {
      if (!u.login) continue;
      map.set(u.login, {
        login: u.login,
        name: u.name ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
      });
    }
    for (const fv of n.fieldValues?.nodes ?? []) {
      for (const u of fv.users?.nodes ?? []) {
        if (!u.login) continue;
        map.set(u.login, {
          login: u.login,
          name: u.name ?? undefined,
          avatarUrl: u.avatarUrl ?? undefined,
        });
      }
    }
  }
  for (const item of items) {
    for (const login of item.assignees ?? []) {
      if (!map.has(login)) map.set(login, { login });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.login.localeCompare(b.login),
  );
}

export async function pullProject(projectId: string): Promise<ProjectDocument> {
  type R = {
    node: {
      id: string;
      number: number;
      title: string;
      url: string;
      owner: { login?: string };
      repositories?: { nodes: Array<{ nameWithOwner: string }> };
      fields: { nodes: RawFieldNode[] };
      items: { nodes: RawItemNode[] };
    } | null;
  };
  const data = await gql<R>(PULL_PROJECT, { id: projectId });
  if (!data.node) {
    throw new GitHubGraphQLError(`Project ${projectId} no encontrado`);
  }
  const node = data.node;
  const fields = mapFields(node.fields?.nodes ?? []);
  const rawItems = node.items?.nodes ?? [];
  const items = mapItems(rawItems, fields);
  const owner = node.owner?.login ?? "unknown";
  const linkedRepos = uniqueRepositorySlugs(
    (node.repositories?.nodes ?? []).map((r) => r.nameWithOwner),
  );

  const doc: ProjectDocument = {
    projectId: node.id,
    number: node.number,
    title: node.title,
    owner,
    url: node.url,
    pulledAt: new Date().toISOString(),
    dirty: false,
    fieldsSchemaVersion: PROJECT_FIELDS_SCHEMA_VERSION,
    tasksSchemaVersion: PROJECT_TASKS_SCHEMA_VERSION,
    fields,
    generalTasks: [],
    items,
    links: { blockedBy: {}, blocks: {} },
    sprints: [],
    currentQuarter: currentCalendarQuarter(),
    people: derivePeople(owner, items, rawItems),
    availableRepositories: linkedRepos,
    issueRepository: null,
  };
  const rebuilt = normalizeProjectHierarchy(
    rebuildProjectHierarchyFromGitHub(doc),
  );
  rebuilt.availableRepositories = uniqueRepositorySlugs(
    linkedRepos,
    inferRepositoriesFromDocument(rebuilt),
  );
  rebuilt.issueRepository = pickDefaultIssueRepository({
    available: rebuilt.availableRepositories,
    doc: rebuilt,
  });
  return rebuilt;
}

export interface CreateFieldInput {
  projectId: string;
  name: string;
  dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT";
  singleSelectOptions?: Array<{
    name: string;
    color: string;
    description: string;
  }>;
}

/**
 * Auto-provision canonical fields that don't yet exist in the GitHub project.
 * Called before the first pull so every column is available on re-fetch.
 * Returns provisioning log (field names created / already existing).
 */
export async function provisionCanonicalFields(
  projectId: string,
  existingFields: ProjectField[],
): Promise<{ created: string[]; existing: string[] }> {
  const result = await ensureAllUiFieldsOnGitHub(existingFields, async (spec) => {
    await createField({ projectId, ...spec });
  });
  const existing = canonicalFieldsCreateSpecs()
    .map((s) => s.name)
    .filter(
      (name) =>
        existingFields.some(
          (f) => f.name.toLowerCase() === name.toLowerCase() && !f.pendingCreate,
        ) && !result.created.includes(name),
    );
  return { created: result.created, existing };
}

const GITHUB_SELECT_COLORS = new Set([
  "GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE",
]);

function normalizeSingleSelectOption(o: {
  name: string;
  color?: string;
  description?: string;
}): { name: string; color: string; description: string } {
  const name = String(o.name ?? "").trim();
  let color = String(o.color ?? "GRAY").toUpperCase();
  if (!GITHUB_SELECT_COLORS.has(color)) color = "GRAY";
  return {
    name: name || "Opción",
    color,
    description: String(o.description ?? ""),
  };
}

export async function createField(
  input: CreateFieldInput,
): Promise<ProjectField> {
  type R = {
    createProjectV2Field: {
      projectV2Field: RawFieldNode;
    };
  };
  const gqlInput: Record<string, unknown> = {
    projectId: input.projectId,
    name: input.name,
    dataType: input.dataType,
  };
  if (input.dataType === "SINGLE_SELECT" && input.singleSelectOptions?.length) {
    // GitHub CreateProjectV2FieldInput.singleSelectOptions is a list of option inputs
    // (not { options: [...] } — that shape triggers singleSelectOptions.0.options errors).
    gqlInput.singleSelectOptions = input.singleSelectOptions.map((o) =>
      normalizeSingleSelectOption(o),
    );
  }
  const data = await gql<R>(CREATE_FIELD, { input: gqlInput });
  const f = data.createProjectV2Field.projectV2Field;
  return {
    id: f.id!,
    name: f.name!,
    dataType: (f.dataType ?? input.dataType) as FieldDataType,
    options: f.options?.map((o) => ({
      id: o.id,
      name: o.name,
      color: o.color,
    })),
  };
}

type FieldValuePayload =
  | { text: string }
  | { number: number }
  | { singleSelectOptionId: string }
  | { iterationId: string }
  | { date: string }
  | { text: string; __multi?: string[] };

export async function updateFieldValues(
  projectId: string,
  itemId: string,
  fieldId: string,
  value: FieldValuePayload,
): Promise<void> {
  const clean = { ...value } as Record<string, unknown>;
  delete clean.__multi;
  await gql(UPDATE_FIELD_VALUE, {
    input: {
      projectId,
      itemId,
      fieldId,
      value: clean,
    },
  });
}

function isLocalStubId(id: string | undefined | null): boolean {
  if (!id) return true;
  return id.startsWith("local_") || id.startsWith("pending_");
}

async function safeUpdateFieldValues(
  projectId: string,
  itemId: string,
  field: ProjectField | undefined,
  value: FieldValuePayload,
): Promise<void> {
  if (!field || field.pendingCreate) return;
  if (isLocalStubId(field.id) || isLocalStubId(itemId)) return;
  try {
    await updateFieldValues(projectId, itemId, field.id, value);
  } catch {
    /* campo o ítem inexistente en GitHub — seguir con el resto */
  }
}

/** Quita un ítem del Project v2 (no borra el Issue en el repo salvo que GH lo haga por draft). */
export async function deleteProjectV2Item(
  projectId: string,
  itemId: string,
): Promise<void> {
  await gql(
    `mutation DeleteProjectItem($input: DeleteProjectV2ItemInput!) {
       deleteProjectV2Item(input: $input) { deletedItemId }
     }`,
    { input: { projectId, itemId } },
  );
}

function findOptionId(
  field: ProjectField | undefined,
  name: string,
): string | undefined {
  return field?.options?.find(
    (o) => o.name.toLowerCase() === name.toLowerCase(),
  )?.id;
}

function collectTaskIdsFromDocument(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const gt of doc.generalTasks) {
    if (gt.id?.trim()) ids.add(gt.id.trim());
  }
  for (const item of doc.items) {
    const t = item.fieldValues.Task;
    const list = Array.isArray(t) ? t : t ? [t] : [];
    for (const raw of list) {
      const s = String(raw).trim();
      if (s) ids.add(s);
    }
  }
  return ids;
}

function replaceFieldFromRaw(
  next: ProjectDocument,
  fieldName: string,
  raw: RawFieldNode,
): void {
  const mapped = mapFields([raw])[0];
  if (!mapped) return;
  const idx = next.fields.findIndex(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
  );
  if (idx >= 0) {
    next.fields[idx] = { ...mapped, pendingCreate: false };
  }
}

/** Agrega opciones faltantes al campo Task (SINGLE_SELECT) para tareas generales nuevas. */
async function ensureGeneralTaskOptionsOnGitHub(
  next: ProjectDocument,
  warnings: string[],
): Promise<void> {
  const taskField = next.fields.find((f) => f.name === CANONICAL_FIELDS.Task);
  if (
    !taskField ||
    taskField.pendingCreate ||
    taskField.dataType !== "SINGLE_SELECT" ||
    isLocalStubId(taskField.id)
  ) {
    return;
  }

  const needed = collectTaskIdsFromDocument(next);
  const existing = taskField.options ?? [];
  const existingNames = new Set(existing.map((o) => o.name.toLowerCase()));
  const missing = [...needed].filter(
    (n) => n && !existingNames.has(n.toLowerCase()),
  );
  if (missing.length === 0) return;

  const mergedOptions = [
    ...existing.map((o) =>
      normalizeSingleSelectOption({
        name: o.name,
        color: o.color,
        description: o.description,
      }),
    ),
    ...missing.map((name) =>
      normalizeSingleSelectOption({ name, color: "BLUE", description: "" }),
    ),
  ];

  try {
    type R = {
      updateProjectV2Field: { projectV2Field: RawFieldNode | null };
    };
    const data = await gql<R>(UPDATE_PROJECT_FIELD, {
      input: {
        fieldId: taskField.id,
        singleSelectOptions: mergedOptions,
      },
    });
    const raw = data.updateProjectV2Field?.projectV2Field;
    if (raw) replaceFieldFromRaw(next, CANONICAL_FIELDS.Task, raw);
  } catch (err) {
    const msg =
      err instanceof GitHubGraphQLError
        ? err.message
        : err instanceof Error
          ? err.message
          : "No se pudieron agregar opciones Task";
    warnings.push(
      `Opciones del campo Task: ${msg}. Revisá el project en GitHub.`,
    );
  }
}

/** Crea un draft issue en el Project v2 y actualiza ids locales del ítem. */
async function createDraftIssueOnGitHub(
  next: ProjectDocument,
  item: ProjectItem,
  opts?: { body?: string },
): Promise<void> {
  const title =
    itemTitleForSync(item) ||
    (item.title && item.title !== "(sin título)" ? item.title : "") ||
    "Nueva subtarea";
  const assigneeIds = await resolveUserNodeIds(item.assignees ?? []);
  type R = {
    addProjectV2DraftIssue: {
      projectItem: {
        id: string;
        content: {
          __typename?: string;
          id?: string;
          title?: string;
        } | null;
      } | null;
    } | null;
  };
  const data = await gql<R>(ADD_DRAFT_ISSUE, {
    input: {
      projectId: next.projectId,
      title,
      body: opts?.body,
      assigneeIds: assigneeIds.length ? assigneeIds : undefined,
    },
  });
  const projectItem = data.addProjectV2DraftIssue?.projectItem;
  if (!projectItem?.id) {
    throw new GitHubGraphQLError("GitHub no devolvió el ítem creado");
  }
  item.nodeId = projectItem.id;
  const content = projectItem.content;
  if (content?.__typename === "DraftIssue" && content.id) {
    item.contentNodeId = content.id;
    item.contentType = "DraftIssue";
    if (content.title) item.title = content.title;
  }
  item.state = "DRAFT";
}

async function syncGeneralTaskDraftOnGitHub(task: GeneralTask): Promise<void> {
  if (!task.githubContentNodeId) return;
  const assigneeIds = await resolveUserNodeIds(task.assignees ?? []);
  const input: Record<string, unknown> = {
    draftIssueId: task.githubContentNodeId,
    title: task.title,
    body: generalTaskBody(task),
    assigneeIds,
  };
  await gql(
    `mutation SyncGeneralDraft($input: UpdateProjectV2DraftIssueInput!) {
       updateProjectV2DraftIssue(input: $input) { draftIssue { id title } }
     }`,
    { input },
  );
}

async function createGeneralTaskDraftOnGitHub(
  next: ProjectDocument,
  task: GeneralTask,
): Promise<void> {
  const title = task.title?.trim() || task.id;
  const assigneeIds = await resolveUserNodeIds(task.assignees ?? []);
  type R = {
    addProjectV2DraftIssue: {
      projectItem: {
        id: string;
        content: {
          __typename?: string;
          id?: string;
          title?: string;
        } | null;
      } | null;
    } | null;
  };
  const data = await gql<R>(ADD_DRAFT_ISSUE, {
    input: {
      projectId: next.projectId,
      title,
      body: generalTaskBody(task),
      assigneeIds: assigneeIds.length ? assigneeIds : undefined,
    },
  });
  const projectItem = data.addProjectV2DraftIssue?.projectItem;
  if (!projectItem?.id) {
    throw new GitHubGraphQLError("GitHub no devolvió la tarea general creada");
  }
  task.githubProjectItemNodeId = projectItem.id;
  const content = projectItem.content;
  if (content?.__typename === "DraftIssue" && content.id) {
    task.githubContentNodeId = content.id;
    if (content.title) task.title = content.title;
  }
}

async function convertProjectItemToIssue(
  projectItemNodeId: string,
  repositoryId: string,
): Promise<{
  projectItemNodeId: string;
  contentNodeId: string;
  number: number | null;
  url: string | null;
}> {
  type R = {
    convertProjectV2DraftIssueItemToIssue: {
      item: {
        id: string;
        content: {
          __typename?: string;
          id?: string;
          number?: number;
          url?: string;
        } | null;
      } | null;
    } | null;
  };
  const data = await gql<R>(CONVERT_DRAFT_TO_ISSUE, {
    input: { itemId: projectItemNodeId, repositoryId },
  });
  const item = data.convertProjectV2DraftIssueItemToIssue?.item;
  const content = item?.content;
  if (content?.__typename !== "Issue" || !content.id || !item?.id) {
    throw new GitHubGraphQLError("No se pudo convertir el draft a issue");
  }
  return {
    projectItemNodeId: item.id,
    contentNodeId: content.id,
    number: content.number ?? null,
    url: content.url ?? null,
  };
}

async function ensureIssueRefForGeneralTask(
  task: GeneralTask,
  repositoryId: string,
): Promise<string> {
  if (task.issueNumber != null && task.githubContentNodeId) {
    return task.githubContentNodeId;
  }
  const itemNodeId = task.githubProjectItemNodeId;
  if (!itemNodeId) {
    throw new GitHubGraphQLError("La tarea general no tiene ítem en GitHub");
  }
  const converted = await convertProjectItemToIssue(itemNodeId, repositoryId);
  task.githubProjectItemNodeId = converted.projectItemNodeId;
  task.githubContentNodeId = converted.contentNodeId;
  task.issueNumber = converted.number;
  task.url = converted.url;
  return converted.contentNodeId;
}

async function ensureIssueRefForSubtask(
  item: ProjectItem,
  repositoryId: string,
): Promise<string> {
  if (item.contentType === "Issue" && item.contentNodeId && item.number != null) {
    return item.contentNodeId;
  }
  const converted = await convertProjectItemToIssue(item.nodeId, repositoryId);
  item.nodeId = converted.projectItemNodeId;
  item.contentNodeId = converted.contentNodeId;
  item.contentType = "Issue";
  item.number = converted.number;
  item.url = converted.url;
  item.state = "OPEN";
  return converted.contentNodeId;
}

function isDuplicateSubIssueError(err: unknown): boolean {
  const msg =
    err instanceof GitHubGraphQLError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return /duplicate sub-issues?/i.test(msg);
}

async function subIssueAlreadyOnParent(
  parentIssueId: string,
  subIssueId: string,
): Promise<boolean> {
  type R = {
    node: { subIssues?: { nodes?: Array<{ id: string }> } } | null;
  };
  try {
    const data = await gql<R>(
      `query ParentSubIssues($id: ID!) {
         node(id: $id) {
           ... on Issue {
             subIssues(first: 100) { nodes { id } }
           }
         }
       }`,
      { id: parentIssueId },
    );
    return (data.node?.subIssues?.nodes ?? []).some((n) => n.id === subIssueId);
  } catch {
    return false;
  }
}

async function linkSubtaskToGeneralTaskOnGitHub(
  _next: ProjectDocument,
  task: GeneralTask,
  item: ProjectItem,
  repositoryId: string,
): Promise<void> {
  const parentIssueId = await ensureIssueRefForGeneralTask(task, repositoryId);
  const subIssueId = await ensureIssueRefForSubtask(item, repositoryId);

  if (item.parentIssueContentId === parentIssueId) {
    item.parentTaskId = task.id;
    return;
  }

  if (await subIssueAlreadyOnParent(parentIssueId, subIssueId)) {
    item.parentIssueContentId = parentIssueId;
    item.parentTaskId = task.id;
    return;
  }

  try {
    await gql(ADD_SUB_ISSUE, {
      input: {
        issueId: parentIssueId,
        subIssueId,
        replaceParent: true,
      },
    });
  } catch (err) {
    if (!isDuplicateSubIssueError(err)) throw err;
  }

  item.parentIssueContentId = parentIssueId;
  item.parentTaskId = task.id;
}

function projectItemFromGeneralTask(task: GeneralTask): ProjectItem | null {
  const nodeId = task.githubProjectItemNodeId;
  if (!nodeId || isLocalStubId(nodeId)) return null;
  return {
    nodeId,
    contentNodeId: task.githubContentNodeId ?? null,
    number: task.issueNumber ?? null,
    title: task.title,
    state:
      task.Status && task.Status.trim()
        ? issueStateFromProjectStatus(task.Status)
        : task.Status === "CLOSED"
          ? "CLOSED"
          : "OPEN",
    url: task.url ?? null,
    contentType: task.issueNumber != null ? "Issue" : "DraftIssue",
    fieldValues: {
      ...(task.githubFieldValues ?? {}),
      Task: [task.id],
      Status: task.Status,
      HasDependency: task.HasDependency,
      DependsOn: task.DependsOn,
      Blocked: task.Blocked,
      BlockedReason: task.BlockedReason,
      Sprint: task.Sprint,
      Quarter: task.Quarter,
      DueDate: task.DueDate,
      Responsable: task.Responsable,
      Assignees: task.assignees,
      Title: task.title,
    },
    parentTaskId: null,
    parentIssueContentId: null,
    assignees: task.assignees ?? [],
  };
}

/** Tras publicar: GitHub manda qué ítems existen; enriquecer planificación local. */
function mergeDocumentAfterPush(
  pushed: ProjectDocument,
  remote: ProjectDocument,
): ProjectDocument {
  return mergeTasksAfterPush(pushed, remote);
}

async function resolveUserNodeIds(logins: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const login of logins) {
    const clean = login.trim().replace(/^@/, "");
    if (!clean) continue;
    type R = { user: { id: string } | null };
    try {
      const data = await gql<R>(
        `query UserNode($login: String!) { user(login: $login) { id } }`,
        { login: clean },
      );
      if (data.user?.id) ids.push(data.user.id);
    } catch {
      // skip unknown login
    }
  }
  return ids;
}

async function syncDraftIssueContent(item: ProjectItem): Promise<void> {
  if (item.contentType !== "DraftIssue" || !item.contentNodeId) return;
  const assigneeIds = await resolveUserNodeIds(item.assignees ?? []);
  const input: Record<string, unknown> = {
    draftIssueId: item.contentNodeId,
    assigneeIds,
  };
  if (item.title && item.title !== "(sin título)") input.title = item.title;
  else {
    const synced = itemTitleForSync(item);
    if (synced) input.title = synced;
  }
  await gql(
    `mutation SyncDraft($input: UpdateProjectV2DraftIssueInput!) {
       updateProjectV2DraftIssue(input: $input) { draftIssue { id title } }
     }`,
    { input },
  );
}

async function syncIssueContent(item: ProjectItem): Promise<void> {
  if (item.contentType !== "Issue" || !item.contentNodeId) return;
  const assigneeIds = await resolveUserNodeIds(item.assignees ?? []);
  const state =
    String(item.state ?? "OPEN").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
  const input: Record<string, unknown> = {
    id: item.contentNodeId,
    assigneeIds,
    state,
  };
  if (item.title && item.title !== "(sin título)") input.title = item.title;
  else {
    const synced = itemTitleForSync(item);
    if (synced) input.title = synced;
  }
  await gql(
    `mutation SyncIssue($input: UpdateIssueInput!) {
       updateIssue(input: $input) { issue { id number title state } }
     }`,
    { input },
  );
}

async function pushTextOrSelect(
  projectId: string,
  itemId: string,
  field: ProjectField | undefined,
  raw: string | undefined | null,
): Promise<void> {
  if (!field || field.pendingCreate || raw == null || raw === "") return;
  if (field.dataType === "SINGLE_SELECT") {
    const optId = findOptionId(field, raw);
    if (optId) {
      await safeUpdateFieldValues(projectId, itemId, field, {
        singleSelectOptionId: optId,
      });
      return;
    }
    return;
  }
  await safeUpdateFieldValues(projectId, itemId, field, {
    text: String(raw),
  });
}

export type PushProjectResult = {
  document: ProjectDocument;
  warnings: string[];
};

function isFieldNameTakenError(err: unknown): boolean {
  const msg =
    err instanceof GitHubGraphQLError
      ? err.message
      : err instanceof Error
        ? err.message
        : "";
  return /name has already been taken/i.test(msg);
}

/** Drop local pending stubs when a real field with the same name already exists. */
function dropRedundantPendingFields(next: ProjectDocument): void {
  const realNames = new Set(
    next.fields
      .filter((f) => !f.pendingCreate)
      .map((f) => f.name.toLowerCase()),
  );
  next.fields = next.fields.filter(
    (f) => !f.pendingCreate || !realNames.has(f.name.toLowerCase()),
  );
}

async function resolvePendingFieldCreate(
  next: ProjectDocument,
  pending: ProjectField,
): Promise<void> {
  const idx = next.fields.findIndex((f) => f.id === pending.id);
  if (idx < 0) return;

  try {
    const created = await createField({
      projectId: next.projectId,
      name: pending.name,
      dataType: pending.dataType as CreateFieldInput["dataType"],
      singleSelectOptions:
        pending.dataType === "SINGLE_SELECT"
          ? (pending.options ?? YES_NO_OPTIONS).map((o) => ({
              name: o.name,
              color: o.color ?? "GRAY",
              description: o.description ?? "",
            }))
          : undefined,
    });
    next.fields[idx] = { ...created, pendingCreate: false };
    return;
  } catch (err) {
    if (!isFieldNameTakenError(err)) throw err;
  }

  const pulled = await pullProject(next.projectId);
  const remote = pulled.fields.find(
    (f) => f.name.toLowerCase() === pending.name.toLowerCase(),
  );
  if (!remote) {
    // Nombre reservado en GitHub pero el campo no aparece en fields (p. ej. borrado).
    next.fields = next.fields.filter((f) => f.id !== pending.id);
    return;
  }

  next.fields[idx] = { ...remote, pendingCreate: false };
  const remoteByName = new Map(
    pulled.fields.map((f) => [f.name.toLowerCase(), f]),
  );
  next.fields = next.fields.map((f) => {
    if (!f.pendingCreate || f.id === pending.id) return f;
    const match = remoteByName.get(f.name.toLowerCase());
    return match ? { ...match, pendingCreate: false } : f;
  });
}

const CANONICAL_NAME_SET = new Set<string>(Object.values(CANONICAL_FIELDS));

/** Alinea `fields` con GitHub antes de crear columnas pendientes. */
async function hydrateFieldsFromGitHub(next: ProjectDocument): Promise<void> {
  let remoteFields: ProjectField[];
  try {
    const pulled = await pullProject(next.projectId);
    remoteFields = pulled.fields;
  } catch {
    return;
  }

  next.fields = mergeGitHubFieldCatalog(next.fields, remoteFields);
  next.fieldsSchemaVersion = PROJECT_FIELDS_SCHEMA_VERSION;
}

/** Refresca nodeId de ítems cuando el issue/draft sigue en GitHub pero cambió el id del project item. */
async function hydrateItemNodeIdsFromGitHub(next: ProjectDocument): Promise<void> {
  try {
    const pulled = await pullProject(next.projectId);
    const byContent = new Map<string, string>();
    const byNumber = new Map<number, string>();
    for (const i of pulled.items) {
      if (i.contentNodeId) byContent.set(i.contentNodeId, i.nodeId);
      if (i.number != null) byNumber.set(i.number, i.nodeId);
    }
    for (const item of next.items) {
      if (isLocalStubId(item.nodeId)) continue;
      if (item.contentNodeId && byContent.has(item.contentNodeId)) {
        item.nodeId = byContent.get(item.contentNodeId)!;
      } else if (item.number != null && byNumber.has(item.number)) {
        item.nodeId = byNumber.get(item.number)!;
      }
    }
  } catch {
    /* seguir con ids locales */
  }
}

/**
 * Push local dirty document to GitHub:
 * 1) create pending fields
 * 2) update item field values for canonical columns
 */
export async function pushProject(
  doc: ProjectDocument,
): Promise<PushProjectResult> {
  const warnings: string[] = [];
  const next: ProjectDocument = structuredClone(doc);
  await hydrateFieldsFromGitHub(next);
  await hydrateItemNodeIdsFromGitHub(next);
  dropRedundantPendingFields(next);

  const pendingFields = [...next.fields.filter((f) => f.pendingCreate)];
  for (const pending of pendingFields) {
    if (!next.fields.some((f) => f.id === pending.id && f.pendingCreate)) {
      continue;
    }
    try {
      await resolvePendingFieldCreate(next, pending);
    } catch (err) {
      const msg =
        err instanceof GitHubGraphQLError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo crear la columna";
      warnings.push(
        `Columna «${pending.name}»: ${msg}. Revisá en GitHub o traé el project de nuevo.`,
      );
      next.fields = next.fields.filter((f) => f.id !== pending.id);
    }
  }

  const byName = (name: string) => next.fields.find((f) => f.name === name);

  await ensureGeneralTaskOptionsOnGitHub(next, warnings);

  let repositoryId: string | null = null;
  try {
    repositoryId = await resolveIssueRepositoryId(gql, {
      projectId: next.projectId,
      doc: next,
    });
  } catch (err) {
    warnings.push(
      err instanceof Error
        ? err.message
        : "Falta elegir «Repo de issues» (o GH_ISSUE_REPOSITORY como fallback).",
    );
  }

  for (const gt of next.generalTasks) {
    if (gt.githubProjectItemNodeId && !isLocalStubId(gt.githubProjectItemNodeId)) {
      try {
        await syncGeneralTaskDraftOnGitHub(gt);
      } catch {
        /* seguir con campos del project */
      }
      continue;
    }
    if (!gt.githubProjectItemNodeId || isLocalStubId(gt.githubProjectItemNodeId)) {
      try {
        await createGeneralTaskDraftOnGitHub(next, gt);
      } catch (err) {
        const msg =
          err instanceof GitHubGraphQLError
            ? err.message
            : err instanceof Error
              ? err.message
              : "No se pudo crear la tarea general";
        warnings.push(`Tarea «${gt.id}»: ${msg}`);
      }
    }
  }

  for (const item of next.items) {
    if (isLocalStubId(item.nodeId)) {
      try {
        await createDraftIssueOnGitHub(next, item);
      } catch (err) {
        const msg =
          err instanceof GitHubGraphQLError
            ? err.message
            : err instanceof Error
              ? err.message
              : "No se pudo crear en GitHub";
        warnings.push(`«${item.title || "Subtarea"}»: ${msg}`);
        continue;
      }
    }

    const parentId = item.parentTaskId?.trim();
    if (repositoryId && parentId) {
      const gt = next.generalTasks.find((g) => g.id === parentId);
      if (gt) {
        try {
          await linkSubtaskToGeneralTaskOnGitHub(next, gt, item, repositoryId);
        } catch (err) {
          const msg =
            err instanceof GitHubGraphQLError
              ? err.message
              : err instanceof Error
                ? err.message
                : "No se pudo vincular sub-issue";
          warnings.push(`«${item.title}» → «${gt.id}»: ${msg}`);
        }
      }
    }
  }

  const pushFieldTargets: ProjectItem[] = [];
  for (const gt of next.generalTasks) {
    const asItem = projectItemFromGeneralTask(gt);
    if (asItem) pushFieldTargets.push(asItem);
  }
  pushFieldTargets.push(...next.items);

  for (const item of pushFieldTargets) {
    const fv = item.fieldValues;

    // Title + assignees (+ issue open/closed) on GitHub content
    try {
      if (item.contentType === "DraftIssue") await syncDraftIssueContent(item);
      else if (item.contentType === "Issue") await syncIssueContent(item);
    } catch {
      // keep pushing field values even if content sync fails
    }

    const titleField = byName("Title");
    const syncTitle = itemTitleForSync(item);
    if (titleField && syncTitle && !titleField.pendingCreate) {
      await safeUpdateFieldValues(next.projectId, item.nodeId, titleField, {
        text: syncTitle,
      });
      fv.Title = syncTitle;
      item.title = syncTitle;
    }

    const statusField = byName("Status");
    if (statusField && !statusField.pendingCreate && fv.Status) {
      const optId = findOptionId(statusField, String(fv.Status));
      if (optId) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, statusField, {
          singleSelectOptionId: optId,
        });
      }
    }

    const taskField = byName(CANONICAL_FIELDS.Task);
    if (taskField && !taskField.pendingCreate && fv.Task) {
      const tasks = Array.isArray(fv.Task) ? fv.Task : [fv.Task];
      const optionIds = tasks
        .map((t) => findOptionId(taskField, String(t)))
        .filter((id): id is string => Boolean(id));
      const primary = tasks.map(String).filter(Boolean).join(", ");
      if (taskField.dataType === "SINGLE_SELECT" && optionIds[0]) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, taskField, {
          singleSelectOptionId: optionIds[0],
        });
      } else if (primary) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, taskField, {
          text: primary,
        });
      } else if (taskField.dataType === "SINGLE_SELECT" && primary) {
        warnings.push(
          `Task «${primary}» no está en las opciones del campo Task en GitHub; agregala al project o elegí otra.`,
        );
      }
    }

    const blockedField = byName(CANONICAL_FIELDS.Blocked);
    if (blockedField && !blockedField.pendingCreate && fv.Blocked) {
      const optId = findOptionId(blockedField, fv.Blocked);
      if (optId) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, blockedField, {
          singleSelectOptionId: optId,
        });
      }
    }

    const reasonField = byName(CANONICAL_FIELDS.BlockedReason);
    if (reasonField && !reasonField.pendingCreate && fv.BlockedReason != null) {
      await safeUpdateFieldValues(next.projectId, item.nodeId, reasonField, {
        text: String(fv.BlockedReason),
      });
    }

    const hasDepField = byName(CANONICAL_FIELDS.HasDependency);
    if (hasDepField && !hasDepField.pendingCreate && fv.HasDependency) {
      const optId = findOptionId(hasDepField, fv.HasDependency);
      if (optId) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, hasDepField, {
          singleSelectOptionId: optId,
        });
      }
    }

    const dependsField = byName(CANONICAL_FIELDS.DependsOn);
    if (dependsField && !dependsField.pendingCreate && fv.DependsOn != null) {
      await safeUpdateFieldValues(next.projectId, item.nodeId, dependsField, {
        text: String(fv.DependsOn),
      });
    }

    await pushTextOrSelect(
      next.projectId,
      item.nodeId,
      byName(CANONICAL_FIELDS.Sprint),
      fv.Sprint,
    );
    await pushTextOrSelect(
      next.projectId,
      item.nodeId,
      byName(CANONICAL_FIELDS.Quarter),
      fv.Quarter,
    );

    const dueField = byName(CANONICAL_FIELDS.DueDate);
    if (dueField && !dueField.pendingCreate && fv.DueDate) {
      await safeUpdateFieldValues(next.projectId, item.nodeId, dueField, {
        date: String(fv.DueDate).slice(0, 10),
      });
    }

    const responsableField = byName(CANONICAL_FIELDS.Responsable);
    if (responsableField && !responsableField.pendingCreate && fv.Responsable) {
      const optId = findOptionId(responsableField, String(fv.Responsable));
      if (optId) {
        await safeUpdateFieldValues(next.projectId, item.nodeId, responsableField, {
          singleSelectOptionId: optId,
        });
      }
    }

    // Push custom (non-canonical) field values
    const canonicalSet = new Set(Object.values(CANONICAL_FIELDS));
    for (const field of next.fields) {
      if (field.pendingCreate || canonicalSet.has(field.name as typeof CANONICAL_FIELDS[keyof typeof CANONICAL_FIELDS])) continue;
      const rawVal = fv[field.name];
      if (rawVal == null || rawVal === "") continue;
      const val = Array.isArray(rawVal) ? rawVal[0] ?? "" : String(rawVal);
      if (!val) continue;
      try {
        if (field.dataType === "SINGLE_SELECT") {
          const optId = findOptionId(field, val);
          if (optId) {
            await safeUpdateFieldValues(next.projectId, item.nodeId, field, {
              singleSelectOptionId: optId,
            });
          }
        } else if (field.dataType === "DATE") {
          await safeUpdateFieldValues(next.projectId, item.nodeId, field, {
            date: val.slice(0, 10),
          });
        } else if (field.dataType === "NUMBER") {
          const num = parseFloat(val);
          if (!Number.isNaN(num)) {
            await safeUpdateFieldValues(next.projectId, item.nodeId, field, {
              number: num,
            });
          }
        } else {
          await safeUpdateFieldValues(next.projectId, item.nodeId, field, {
            text: val,
          });
        }
      } catch {
        // Non-fatal — skip field push if it fails
      }
    }
  }

  try {
    const remote = await pullProject(next.projectId);
    const merged = mergeDocumentAfterPush(next, remote);
    merged.dirty = warnings.length > 0;
    merged.pulledAt = new Date().toISOString();
    return { document: merged, warnings };
  } catch {
    next.dirty = warnings.length > 0;
    next.pulledAt = new Date().toISOString();
    return { document: next, warnings };
  }
}

/** Ensure local doc has canonical field stubs (for offline / before push). */
export function ensureCanonicalFields(
  doc: ProjectDocument,
  opts?: { addPendingStubs?: boolean },
): ProjectDocument {
  const next = structuredClone(doc);
  const addPendingStubs = opts?.addPendingStubs ?? true;
  const names = new Set(next.fields.map((f) => f.name));

  if (!names.has(CANONICAL_FIELDS.Task)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_task_${Date.now()}`,
        name: CANONICAL_FIELDS.Task,
        dataType: "TEXT",
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.Blocked)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_blocked_${Date.now()}`,
        name: CANONICAL_FIELDS.Blocked,
        dataType: "SINGLE_SELECT",
        options: BLOCKED_OPTIONS,
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.BlockedReason)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_reason_${Date.now()}`,
        name: CANONICAL_FIELDS.BlockedReason,
        dataType: "TEXT",
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.HasDependency)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_hasdep_${Date.now()}`,
        name: CANONICAL_FIELDS.HasDependency,
        dataType: "SINGLE_SELECT",
        options: YES_NO_OPTIONS,
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.DependsOn)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_depends_${Date.now()}`,
        name: CANONICAL_FIELDS.DependsOn,
        dataType: "TEXT",
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.Sprint)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_sprint_${Date.now()}`,
        name: CANONICAL_FIELDS.Sprint,
        dataType: "TEXT",
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.Quarter)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_quarter_${Date.now()}`,
        name: CANONICAL_FIELDS.Quarter,
        dataType: "SINGLE_SELECT",
        options: [
          { id: "opt-q1", name: "Q1", color: "BLUE" },
          { id: "opt-q2", name: "Q2", color: "GREEN" },
          { id: "opt-q3", name: "Q3", color: "YELLOW" },
          { id: "opt-q4", name: "Q4", color: "ORANGE" },
        ],
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.DueDate)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_due_${Date.now()}`,
        name: CANONICAL_FIELDS.DueDate,
        dataType: "DATE",
        pendingCreate: true,
      });
    }
  }
  if (!names.has(CANONICAL_FIELDS.Responsable)) {
    if (addPendingStubs) {
      next.fields.push({
        id: `local_responsable_${Date.now()}`,
        name: CANONICAL_FIELDS.Responsable,
        dataType: "SINGLE_SELECT",
        options: RESPONSABLE_OPTIONS,
        pendingCreate: true,
      });
    }
  }

  if (!next.sprints) next.sprints = [];
  if (!next.currentQuarter) next.currentQuarter = currentCalendarQuarter();
  if (!next.people) next.people = next.owner ? [{ login: next.owner }] : [];

  // Backfill HasDependency from DependsOn for older fixtures
  for (const item of next.items) {
    if (!Array.isArray(item.assignees)) {
      const fromFv = item.fieldValues.Assignees;
      item.assignees = asStringList(fromFv);
    }
    if (
      item.fieldValues.HasDependency == null &&
      typeof item.fieldValues.DependsOn === "string" &&
      item.fieldValues.DependsOn.trim()
    ) {
      item.fieldValues.HasDependency = "Sí";
    }
  }

  return next;
}
