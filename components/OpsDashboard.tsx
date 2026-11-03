"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GeneralTask,
  GitHubProjectSummary,
  IndexEntry,
  ProjectDocument,
  ProjectItem,
} from "@/lib/types";
import { friendlyGitHubError } from "@/lib/githubFriendlyError";
import { taskFieldValueForParent } from "@/lib/taskParent";
import { asStringList } from "@/lib/fieldValueCoerce";
import { isViewOnly } from "@/lib/viewOnly";
import { CalendarView } from "./CalendarView";
import { HierarchyTable } from "./HierarchyTable";
import { ProjectProgressSummary } from "./ProjectProgressSummary";
import { MacroObjectivesPanel } from "./MacroObjectivesPanel";
import { RakkauNotice } from "./RakkauNotice";
import { SprintPanel } from "./SprintPanel";

interface ProjectsResponse {
  local: IndexEntry[];
  remote: GitHubProjectSummary[] | null;
  remoteError: string | null;
  hasToken: boolean;
}

type TabId = "objetivos" | "tareas" | "sprints" | "calendario";

const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "objetivos", label: "Objetivos Q" },
  { id: "tareas", label: "Tareas" },
  { id: "sprints", label: "Sprints" },
  { id: "calendario", label: "Calendario" },
];

export function OpsDashboard() {
  const viewOnly = isViewOnly();
  const tabs = viewOnly
    ? ALL_TABS.filter((t) => t.id !== "objetivos")
    : ALL_TABS;
  const [local, setLocal] = useState<IndexEntry[]>([]);
  const [remote, setRemote] = useState<GitHubProjectSummary[] | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("tareas");
  /** URL / owner/nº / PVT_ para traer un Project (acceso sin ser owner). */
  const [sharedRef, setSharedRef] = useState("");

  /**
   * projectRef is the source of truth for edits. Never patch from a closed-over
   * `project` snapshot — that is what made the 2nd Abierta/Cerrada “bounce back”.
   */
  const projectRef = useRef<ProjectDocument | null>(null);
  const localRevRef = useRef(0);
  const persistedRevRef = useRef(0);
  const flushInFlightRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIndexRef = useRef<() => Promise<void>>(async () => {});

  const replaceProject = useCallback((doc: ProjectDocument | null) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    projectRef.current = doc;
    localRevRef.current += 1;
    persistedRevRef.current = localRevRef.current;
    setProject(doc);
  }, []);

  // Keep ref aligned after render (Fast Refresh can reset refs but keep state).
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const loadIndex = useCallback(async () => {
    const res = await fetch("/api/projects?remote=1");
    const data = (await res.json()) as ProjectsResponse;
    const localList = data.local ?? [];
    setLocal(localList);
    setHasToken(data.hasToken);
    if (data.remoteError) setMessage(data.remoteError);

    // Conservar Projects abiertos por URL/id que no vienen en el listado del viewer
    // (compartidos sin ser owner) y los ya bajados en local.
    setRemote((prevOpened) => {
      const listed = data.remote;
      if (listed === null) return prevOpened;
      const byId = new Map(listed.map((p) => [p.id, p]));
      for (const p of prevOpened ?? []) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      for (const loc of localList) {
        if (!byId.has(loc.projectId) && !loc.projectId.includes("DEMO")) {
          byId.set(loc.projectId, {
            id: loc.projectId,
            number: loc.number,
            title: loc.title,
            url: "",
            owner: loc.owner,
            repositories: [],
          });
        }
      }
      return Array.from(byId.values()).sort((a, b) =>
        a.title.localeCompare(b.title, "es"),
      );
    });

    if (data.hasToken) {
      const remoteIds = new Set((data.remote ?? []).map((p) => p.id));
      const localIds = new Set(localList.map((p) => p.projectId));
      setSelectedId((prev) => {
        if (!prev) return prev;
        if (remoteIds.has(prev) || localIds.has(prev)) return prev;
        // Fixtures demo no deben quedar seleccionados con token activo.
        if (prev.includes("DEMO")) return "";
        // Conservar Project compartido abierto por URL/id (fuera del listado).
        return prev;
      });
    } else if (!selectedId && localList.length) {
      setSelectedId(localList[0].projectId);
    }
  }, [selectedId]);

  loadIndexRef.current = loadIndex;

  const loadProject = useCallback(
    async (id: string) => {
      if (!id) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
        if (res.status === 404) {
          // Remoto listado / abierto por URL pero aún no traído → sin error.
          replaceProject(null);
          return;
        }
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const doc = (await res.json()) as ProjectDocument;
        replaceProject(doc);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar proyecto");
        replaceProject(null);
      } finally {
        setBusy(false);
      }
    },
    [replaceProject],
  );

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    if (selectedId) {
      void loadProject(selectedId);
    } else {
      // Sin selección: limpiar datos para no mostrar proyecto fantasma
      replaceProject(null);
      setError(null);
    }
  }, [selectedId, loadProject, replaceProject]);

  const flushPersist = useCallback(async () => {
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      while (persistedRevRef.current < localRevRef.current) {
        const rev = localRevRef.current;
        const snap = projectRef.current;
        if (!snap) {
          persistedRevRef.current = rev;
          break;
        }
        if (localRevRef.current !== rev) {
          continue;
        }
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(snap.projectId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(snap),
            },
          );
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "No se pudo guardar");
          if (localRevRef.current !== rev) {
            continue;
          }
          persistedRevRef.current = rev;
          void body;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error al guardar");
          break;
        }
      }
      await loadIndexRef.current();
    } finally {
      flushInFlightRef.current = false;
      if (persistedRevRef.current < localRevRef.current) {
        void flushPersist();
      }
    }
  }, []);

  /** Mutate from projectRef and coalesce JSON writes to the latest snapshot. */
  const commitLocal = useCallback(
    (updater: (prev: ProjectDocument) => ProjectDocument) => {
      if (viewOnly) return;
      const prev = projectRef.current;
      if (!prev) return;
      const next = updater(prev);
      projectRef.current = next;
      localRevRef.current += 1;
      setProject(next);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      // Coalesce burst edits (title keystrokes + rapid Estado clicks) into one PUT.
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void flushPersist();
      }, 40);
    },
    [flushPersist, viewOnly],
  );

  function onChangeItem(
    nodeId: string,
    patch: Partial<ProjectItem["fieldValues"]>,
  ) {
    commitLocal((project) => {
      const items = project.items.map((item) => {
        if (item.nodeId !== nodeId) return item;
        const fieldValues = { ...item.fieldValues, ...patch };
        let parentTaskId = item.parentTaskId;
        if (patch.Task !== undefined) {
          const t = patch.Task;
          parentTaskId = Array.isArray(t) ? t[0] ?? null : t || null;
        }
        let assignees = item.assignees ?? [];
        if (patch.Assignees !== undefined) {
          assignees = asStringList(patch.Assignees);
        }
        return { ...item, fieldValues, parentTaskId, assignees };
      });
      return { ...project, items, dirty: true };
    });
  }

  function onPatchItem(nodeId: string, patch: Partial<ProjectItem>) {
    commitLocal((project) => {
      const items = project.items.map((item) => {
        if (item.nodeId !== nodeId) return item;
        const fieldValues = patch.fieldValues
          ? { ...item.fieldValues, ...patch.fieldValues }
          : { ...item.fieldValues };
        if (patch.title !== undefined) {
          fieldValues.Title = patch.title;
        }
        const assignees = patch.assignees ?? item.assignees ?? [];
        let parentTaskId = item.parentTaskId;
        if (fieldValues.Task !== undefined) {
          const t = fieldValues.Task;
          parentTaskId = Array.isArray(t) ? t[0] ?? null : t || null;
        }
        return {
          ...item,
          ...patch,
          fieldValues: { ...fieldValues, Assignees: assignees },
          assignees,
          parentTaskId,
        };
      });
      const people = [...(project.people ?? [])];
      for (const login of patch.assignees ?? []) {
        if (!people.some((p) => p.login === login)) {
          people.push({ login });
        }
      }
      return { ...project, items, people, dirty: true };
    });
  }

  function onPatchGeneralTask(id: string, patch: Partial<GeneralTask>) {
    commitLocal((project) => {
      const generalTasks = project.generalTasks.map((t) => {
        if (t.id !== id) return t;
        const next: GeneralTask = { ...t, ...patch };
        if (patch.githubFieldValues) {
          next.githubFieldValues = {
            ...(t.githubFieldValues ?? {}),
            ...patch.githubFieldValues,
          };
        }
        return next;
      });
      const people = [...(project.people ?? [])];
      for (const login of patch.assignees ?? []) {
        if (!people.some((p) => p.login === login)) people.push({ login });
      }
      return { ...project, generalTasks, people, dirty: true };
    });
  }

  function onAddGeneralTask(id: string, title: string) {
    commitLocal((project) => {
      const task: GeneralTask = {
        id,
        title,
        Status: "",
        HasDependency: "No",
        DependsOn: "",
        Blocked: "No",
        BlockedReason: "",
        Responsable: "",
        EstadoOperativo: "a tiempo",
        assignees: [],
        Sprint: "",
        Quarter: project.currentQuarter?.quarter ?? "",
        githubProjectItemNodeId: `local_general_${Date.now()}_${localRevRef.current}`,
        githubContentNodeId: null,
        issueNumber: null,
        url: null,
      };
      const generalTasks = [...project.generalTasks, task];
      const fields = project.fields.map((f) => {
        if (f.name !== "Task") return f;
        const options = [...(f.options ?? [])];
        if (!options.some((o) => o.name === id)) {
          options.push({
            id: `opt-${id.toLowerCase()}`,
            name: id,
            color: "BLUE",
          });
        }
        return { ...f, options };
      });
      return { ...project, generalTasks, fields, dirty: true };
    });
  }

  function onAddSubtask(title: string, parentTaskId: string) {
    commitLocal((project) => {
      const nodeId = `local_item_${Date.now()}_${localRevRef.current}`;
      const taskFv = taskFieldValueForParent(project, parentTaskId);
      const item: ProjectItem = {
        nodeId,
        number: null,
        title,
        state: "DRAFT",
        url: null,
        contentType: "DraftIssue",
        fieldValues: {
          Task: taskFv,
          HasDependency: "No",
          DependsOn: "",
          Blocked: "No",
          BlockedReason: "",
          Assignees: [],
        },
        parentTaskId,
        assignees: [],
        blockedBy: [],
        blocks: [],
      };
      return {
        ...project,
        items: [...project.items, item],
        dirty: true,
      };
    });
  }

  async function onAddField(field: import("@/lib/types").ProjectField) {
    const id = projectRef.current?.projectId ?? selectedId;
    if (!id) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(id)}/fields`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: field.name,
            dataType: field.dataType,
            options: field.options,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "No se pudo crear la columna");
      }
      replaceProject(body.project as ProjectDocument);
      if (body.createdOnGitHub) {
        setMessage(`Columna "${field.name}" creada en GitHub y en este proyecto.`);
      } else if (body.offline) {
        setMessage(
          `Columna "${field.name}" guardada localmente. Publicá en GitHub cuando tengas token.`,
        );
      } else {
        setMessage(`Columna "${field.name}" agregada.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al crear columna";
      setError(friendlyGitHubError(msg));
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteItem(nodeId: string) {
    const id = projectRef.current?.projectId ?? selectedId;
    if (!id) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(id)}/items/${encodeURIComponent(nodeId)}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo eliminar");
      replaceProject(body.project as ProjectDocument);
      setMessage(
        body.removedFromGitHub
          ? "Tarea eliminada del proyecto y de GitHub."
          : "Tarea eliminada del JSON local.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    } finally {
      setBusy(false);
    }
  }

  function onDeleteGeneralTask(taskId: string) {
    commitLocal((project) => {
      const fields = project.fields.map((f) => {
        if (f.name !== "Task") return f;
        const options = (f.options ?? []).filter((o) => o.name !== taskId);
        return { ...f, options };
      });
      const items = project.items.map((item) => {
        if (item.parentTaskId !== taskId) return item;
        return {
          ...item,
          parentTaskId: null,
          fieldValues: {
            ...item.fieldValues,
            Task: [],
          },
        };
      });
      const macroTasks = (project.macroTasks ?? []).map((m) => ({
        ...m,
        generalTaskIds: (m.generalTaskIds ?? []).filter((id) => id !== taskId),
      }));
      return {
        ...project,
        generalTasks: project.generalTasks.filter((t) => t.id !== taskId),
        items,
        fields,
        macroTasks,
        dirty: true,
      };
    });
    setMessage(`Tarea ${taskId} eliminada.`);
  }

  function onUpdateProject(patch: Partial<ProjectDocument>) {
    commitLocal((project) => ({ ...project, ...patch, dirty: true }));
  }

  async function pullById(id: string, force = false): Promise<boolean> {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(id)}/pull`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      },
    );
    const body = await res.json();
    if (res.status === 409) {
      setError(
        body.error ??
          "Hay cambios locales sin publicar. Publicá primero o confirmá sobrescribir.",
      );
      return false;
    }
    if (!res.ok && !body.project) {
      throw new Error(body.error ?? "No se pudo traer de GitHub");
    }
    if (!res.ok && body.project) {
      replaceProject(body.project);
      setError(
        friendlyGitHubError(
          body.message ?? body.error ?? "No se pudo traer de GitHub",
        ),
      );
      await loadIndex();
      return false;
    }
    if (body.project) replaceProject(body.project);
    const pullMsg = String(body.message ?? "");
    if (pullMsg.includes("API falló")) {
      const inner = pullMsg.match(/\(([^)]+)\)/)?.[1]?.trim() ?? pullMsg;
      setError(friendlyGitHubError(inner));
    } else if (pullMsg) {
      setMessage(pullMsg);
    } else if (body.offline) {
      setMessage("Modo offline — se mantiene el JSON local.");
    } else {
      const doc = body.project as ProjectDocument | undefined;
      const n = doc?.generalTasks?.length ?? 0;
      const s = doc?.items?.length ?? 0;
      setMessage(
        `Datos actualizados desde GitHub (${n} tarea${n === 1 ? "" : "s"} general${n === 1 ? "" : "es"}, ${s} subtarea${s === 1 ? "" : "s"}).`,
      );
    }
    await loadIndex();
    return true;
  }

  async function onPull(force = false) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await pullById(selectedId, force);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo traer de GitHub");
    } finally {
      setBusy(false);
    }
  }

  /** Traer Project (URL, owner/nº o PVT_) → lookup + pull JSON local; sin mutar GitHub. */
  async function onOpenShared() {
    const ref = sharedRef.trim();
    if (!ref) {
      setError(
        "Pegá la URL del Project, owner/número (ej. org/3) o el id PVT_.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/projects/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const body = await res.json();
      if (!res.ok || !body.project) {
        throw new Error(body.error ?? "No se pudo traer el Project");
      }
      const summary = body.project as GitHubProjectSummary;
      setRemote((prev) => {
        const byId = new Map((prev ?? []).map((p) => [p.id, p]));
        byId.set(summary.id, summary);
        return Array.from(byId.values()).sort((a, b) =>
          a.title.localeCompare(b.title, "es"),
        );
      });
      setSelectedId(summary.id);
      setSharedRef("");
      setMessage(
        `Trayendo ${summary.title} (#${summary.number} · ${summary.owner})…`,
      );
      await pullById(summary.id, false);
    } catch (e) {
      setError(
        friendlyGitHubError(
          e instanceof Error ? e.message : "No se pudo traer el Project",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPush() {
    if (!selectedId) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!flushInFlightRef.current) resolve();
        else setTimeout(tick, 25);
      };
      tick();
    });
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(selectedId)}/push`,
        { method: "POST" },
      );
      const body = await res.json();
      if (body.project) replaceProject(body.project);
      if (!res.ok) {
        setError(
          friendlyGitHubError(
            body.message ?? body.error ?? "No se pudo publicar en GitHub",
          ),
        );
      } else if (body.warnings?.length > 0) {
        setMessage(
          `Se publicó en GitHub con avisos: ${body.warnings.join(" ")}`,
        );
      } else {
        setMessage(
          "Cambios publicados: tareas generales y subtareas en GitHub (sub-issues).",
        );
      }
      await loadIndex();
    } catch (e) {
      setError(
        friendlyGitHubError(
          e instanceof Error ? e.message : "No se pudo publicar en GitHub",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const selectOptions: Array<{ id: string; label: string }> = [];
  if (hasToken && remote !== null) {
    // Con token: listado remoto (+ abiertos por URL / ya locales).
    const localById = new Map(local.map((p) => [p.projectId, p]));
    for (const p of remote) {
      const loc = localById.get(p.id);
      const suffix = loc
        ? loc.dirty
          ? " · cambios sin publicar"
          : " · sincronizado"
        : " · no descargado";
      const ownerHint = p.owner ? ` · ${p.owner}` : "";
      selectOptions.push({
        id: p.id,
        label: `${p.title} (#${p.number}${ownerHint})${suffix}`,
      });
    }
  } else {
    // Sin token: mostrar locales (fixture / demo).
    for (const p of local) {
      selectOptions.push({
        id: p.projectId,
        label: `${p.title} (#${p.number}) · local${p.dirty ? " · cambios sin publicar" : ""}`,
      });
    }
  }

  const remoteRepos =
    remote?.find((p) => p.id === selectedId)?.repositories ?? [];
  const issueRepoOptions = Array.from(
    new Set(
      [
        ...(project?.availableRepositories ?? []),
        ...remoteRepos,
        project?.issueRepository ?? "",
      ]
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  );

  return (
    <div className="app-shell">
      <header className="rk-header">
        <div className="rk-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/rakkau-logo.png"
            alt="rakkau"
            className="rk-logo"
            width={140}
            height={56}
          />
        </div>
        <div className="rk-status">
          {viewOnly ? (
            <span
              className="rk-pill rk-pill-ok"
              title="NEXT_PUBLIC_VIEW_ONLY — sin mutaciones a GitHub ni JSON"
            >
              Solo lectura
            </span>
          ) : null}
          <span
            className={`rk-pill ${hasToken ? "rk-pill-ok" : "rk-pill-offline"}`}
            title={
              hasToken
                ? "Token GH_TOKEN detectado en el entorno"
                : "Sin GH_TOKEN — modo offline con JSON local"
            }
          >
            {hasToken ? "Conectado a GitHub" : "Sin conexión (demo local)"}
          </span>
          {!viewOnly && project?.dirty ? (
            <span
              className="rk-pill rk-pill-dirty"
              title="Hay ediciones locales pendientes de publicar (dirty)"
            >
              Cambios sin publicar
            </span>
          ) : project ? (
            <span className="rk-pill rk-pill-ok">Al día</span>
          ) : null}
        </div>
      </header>

      <div className="rk-toolbar">
        <select
          className="rk-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Selector de Project"
        >
          <option value="">Elegí un Project…</option>
          {selectOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        {hasToken ? (
          <label className="rk-open-shared">
            <span className="rk-repo-picker-label">Traer</span>
            <span className="rk-open-shared-row">
              <input
                className="rk-input rk-open-shared-input"
                type="text"
                value={sharedRef}
                disabled={busy}
                placeholder="URL, owner/nº o PVT_…"
                aria-label="URL o id de Project a traer"
                onChange={(e) => setSharedRef(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onOpenShared();
                  }
                }}
              />
              <button
                type="button"
                className="rk-btn rk-btn-ghost"
                disabled={busy || !sharedRef.trim()}
                onClick={() => void onOpenShared()}
                title={
                  viewOnly
                    ? "Trae el Project y actualiza el JSON local (solo lectura; no crea fields ni issues)"
                    : "Trae el Project al que tenés acceso (aunque no seas owner) y actualiza el JSON local"
                }
              >
                Traer
              </button>
            </span>
          </label>
        ) : null}

        {viewOnly ? (
          project?.issueRepository ? (
            <span
              className="rk-repo-picker rk-repo-readonly"
              title="Repo vinculado al Project (dato, no editable)"
            >
              <span className="rk-repo-picker-label">Repo</span>
              <span className="rk-pill">{project.issueRepository}</span>
            </span>
          ) : null
        ) : (
          <label className="rk-repo-picker">
            <span className="rk-repo-picker-label">Repo de issues</span>
            <select
              className="rk-select rk-repo-select"
              value={project?.issueRepository ?? ""}
              disabled={!project || busy || issueRepoOptions.length === 0}
              aria-label="Repo de issues"
              title="Repos de GitHub vinculados al Project (issues / sub-issues al publicar)"
              onChange={(e) => {
                const value = e.target.value.trim();
                commitLocal((prev) => ({
                  ...prev,
                  issueRepository: value || null,
                  availableRepositories: Array.from(
                    new Set([
                      ...(prev.availableRepositories ?? []),
                      ...issueRepoOptions,
                    ]),
                  ),
                }));
              }}
            >
              <option value="">
                {issueRepoOptions.length
                  ? "Elegí un repo de GitHub…"
                  : "Sin repos (traé el Project)"}
              </option>
              {issueRepoOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}

        {!viewOnly && (
          <button
            type="button"
            className="rk-btn rk-btn-primary"
            disabled={!selectedId || busy}
            onClick={() => void onPush()}
            title="updateProjectV2ItemFieldValue / createProjectV2Field"
          >
            Publicar en GitHub
          </button>
        )}
        <button
          type="button"
          className={viewOnly ? "rk-btn rk-btn-primary" : "rk-btn rk-btn-ghost"}
          disabled={!selectedId || busy}
          onClick={() => void onPull(false)}
          title={
            viewOnly
              ? "Trae el Project y actualiza el JSON local (sin createField / push)"
              : "Trae el Project remoto y sobrescribe el JSON local"
          }
        >
          {viewOnly ? "Traer" : "Traer de GitHub"}
        </button>
        {!viewOnly && project?.dirty && (
          <button
            type="button"
            className="rk-btn rk-btn-ghost"
            disabled={!selectedId || busy}
            onClick={() => void onPull(true)}
            title="force pull — sobrescribe cambios locales sin publicar"
          >
            Traer y sobrescribir
          </button>
        )}
      </div>

      {message && (
        <RakkauNotice variant="ok" title="Listo" onDismiss={() => setMessage(null)}>
          {message}
        </RakkauNotice>
      )}
      {error && (
        <RakkauNotice
          variant="error"
          title={
            /columna ya existe|name has already been taken/i.test(error)
              ? "Columna duplicada en GitHub"
              : "No se pudo completar"
          }
          onDismiss={() => setError(null)}
        >
          {friendlyGitHubError(error)}
        </RakkauNotice>
      )}

      {!project && !busy && (
        <div className="rk-empty">
          <h2>Planilla operativa Rakkau</h2>
          <p>
            {hasToken && selectedId
              ? "Este Project todavía no está en el JSON local. Usá «Traer» (listado o URL / owner/nº / PVT_)."
              : hasToken
                ? "Elegí un Project del listado, o pegá URL / owner/nº / id PVT_ y usá «Traer» (aunque no seas owner)."
                : "Elegí el demo o un Project de GitHub. Sin token la UI funciona con el JSON local: tareas, sprints y calendario."}
          </p>
        </div>
      )}

      {project && (
        <>
          <div className="rk-project-meta">
            <div>
              <h1 className="rk-project-title">{project.title}</h1>
              <div className="rk-status">
                <span className="rk-pill">
                  #{project.number} · {project.owner}
                </span>
                {project.pulledAt && (
                  <span className="rk-pill">
                    Última sync {new Date(project.pulledAt).toLocaleString("es")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <nav className="rk-tabs" aria-label="Secciones">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`rk-tab${tab === t.id ? " rk-tab-active" : ""}`}
                onClick={() => setTab(t.id)}
                aria-selected={tab === t.id}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {!viewOnly && tab === "objetivos" && (
            <section aria-label="Objetivos del quarter">
              <MacroObjectivesPanel
                project={project}
                onUpdate={onUpdateProject}
                onPatchGeneralTask={onPatchGeneralTask}
              />
            </section>
          )}

          {tab === "tareas" && (
            <section aria-label={viewOnly ? "Progreso de tareas" : "Tareas y subtareas"}>
              <div className="rk-section-head">
                <h2 className="rk-section-title">
                  {viewOnly
                    ? "Progreso de tareas"
                    : "Tareas generales y subtareas"}
                </h2>
              </div>
              {viewOnly ? <ProjectProgressSummary project={project} /> : null}
              <HierarchyTable
                project={project}
                viewOnly={viewOnly}
                onChangeItem={onChangeItem}
                onPatchItem={onPatchItem}
                onPatchGeneralTask={onPatchGeneralTask}
                onAddGeneralTask={onAddGeneralTask}
                onAddSubtask={onAddSubtask}
                onAddField={onAddField}
                onDeleteItem={onDeleteItem}
                onDeleteGeneralTask={onDeleteGeneralTask}
              />
            </section>
          )}

          {tab === "sprints" && (
            <SprintPanel
              project={project}
              onUpdate={viewOnly ? () => undefined : onUpdateProject}
            />
          )}

          {tab === "calendario" && <CalendarView project={project} />}
        </>
      )}
    </div>
  );
}
