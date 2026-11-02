import { promises as fs } from "fs";
import path from "path";
import type { IndexEntry, ProjectDocument, ProjectsIndex } from "@/lib/types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

/** Serialize writes per project so overlapping PUTs cannot clobber JSON. */
const writeLocks = new Map<string, Promise<unknown>>();

async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  writeLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (writeLocks.get(key) === next) writeLocks.delete(key);
  }
}

function safeProjectFileName(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.json`;
}

export function projectFilePath(projectId: string): string {
  return path.join(PROJECTS_DIR, safeProjectFileName(projectId));
}

export function relativeProjectPath(projectId: string): string {
  return path.posix.join("data", "projects", safeProjectFileName(projectId));
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

export async function readIndex(): Promise<ProjectsIndex> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    return JSON.parse(raw) as ProjectsIndex;
  } catch {
    const empty: ProjectsIndex = { updatedAt: new Date().toISOString(), projects: [] };
    await writeIndex(empty);
    return empty;
  }
}

export async function writeIndex(index: ProjectsIndex): Promise<void> {
  await ensureDirs();
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + "\n", "utf8");
}

export async function upsertIndexEntry(entry: IndexEntry): Promise<ProjectsIndex> {
  const index = await readIndex();
  const idx = index.projects.findIndex((p) => p.projectId === entry.projectId);
  if (idx >= 0) {
    index.projects[idx] = entry;
  } else {
    index.projects.push(entry);
  }
  await writeIndex(index);
  return index;
}

export async function readProject(projectId: string): Promise<ProjectDocument | null> {
  await ensureDirs();
  const candidates = [
    projectFilePath(projectId),
    // demo fixture may use a friendly name
    path.join(PROJECTS_DIR, "demo.json"),
  ];

  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const doc = JSON.parse(raw) as ProjectDocument;
      if (doc.projectId === projectId || file.endsWith("demo.json")) {
        if (doc.projectId === projectId) return doc;
      }
    } catch {
      /* try next */
    }
  }

  // Resolve via index path
  const index = await readIndex();
  const entry = index.projects.find((p) => p.projectId === projectId);
  if (!entry) return null;
  const abs = path.join(ROOT, entry.path);
  try {
    const raw = await fs.readFile(abs, "utf8");
    return JSON.parse(raw) as ProjectDocument;
  } catch {
    return null;
  }
}

export async function writeProject(doc: ProjectDocument): Promise<string> {
  return withWriteLock(`project:${doc.projectId}`, async () => {
    await ensureDirs();
    const index = await readIndex();
    const existing = index.projects.find((p) => p.projectId === doc.projectId);
    const rel = existing?.path ?? relativeProjectPath(doc.projectId);
    const abs = path.join(ROOT, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(doc, null, 2) + "\n", "utf8");
    await upsertIndexEntry({
      projectId: doc.projectId,
      number: doc.number,
      title: doc.title,
      owner: doc.owner,
      path: rel,
      dirty: doc.dirty,
      pulledAt: doc.pulledAt,
    });
    return rel;
  });
}

export async function listLocalProjects(): Promise<IndexEntry[]> {
  const index = await readIndex();
  return index.projects;
}
