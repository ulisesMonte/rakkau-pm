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
import { CalendarView } from "./CalendarView";
import { HierarchyTable } from "./HierarchyTable";
import { RakkauNotice } from "./RakkauNotice";
import { SprintPanel } from "./SprintPanel";

interface ProjectsResponse {
  local: IndexEntry[];
  remote: GitHubProjectSummary[] | null;
  remoteError: string | null;
  hasToken: boolean;
}

type TabId = "tareas" | "sprints" | "calendario";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "tareas", label: "Tareas" },
  { id: "sprints", label: "Sprints" },
  { id: "calendario", label: "Calendario" },
];

export function OpsDashboard() {
  const [local, setLocal] = useState<IndexEntry[]>([]);
  const [remote, setRemote] = useState<GitHubProjectSummary[] | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("tareas");

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
    setRemote(data.remote);
    setHasToken(data.hasToken);
    if (data.remoteError) setMessage(data.remoteError);

    if (data.hasToken) {
      // Con token: los remotos son la fuente de verdad.
      // Si el selectedId actual es solo local (fixture/demo) y no existe entre los
      // remotos, borrarlo para que el dropdown muestre "Elegí un Project…" limpio.
      const remoteIds = new Set((data.remote ?? []).map((p) => p.id));
      setSelectedId((prev) => (prev && !remoteIds.has(prev) ? "" : prev));
    } else {
      // Sin token: auto-seleccionar el primer local solo si no hay selección.
      if (!selectedId && localList.length) {
        setSelectedId(localList[0].projectId);
      }
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
    [flushPersist],
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
          assignees = Array.isArray(patch.Assignees)
            ? patch.Assignees
            : typeof patch.Assignees === "string"
              ? patch.Assignees.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
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
      const generalTasks = project.generalTasks.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      );
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
      return {
        ...project,
        generalTasks: project.generalTasks.filter((t) => t.id !== taskId),
        items,
        fields,
        dirty: true,
      };
    });
    setMessage(`Tarea ${taskId} eliminada.`);
  }

  function onUpdateProject(patch: Partial<ProjectDocument>) {
    commitLocal((project) => ({ ...project, ...patch, dirty: true }));
  }

  async function onPull(force = false) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(selectedId)}/pull`,
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
        return;
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
        return;
      }
      if (body.project) replaceProject(body.project);
      const pullMsg = String(body.message ?? "");
      if (pullMsg.includes("API falló")) {
        const inner =
          pullMsg.match(/\(([^)]+)\)/)?.[1]?.trim() ?? pullMsg;
        setError(friendlyGitHubError(inner));
      } else if (pullMsg) {
        setMessage(pullMsg);
      } else if (body.offline) {
        setMessage("Modo offline — se mantiene el JSON local.");
      } else {
        const n =
          (body.project as ProjectDocument | undefined)?.generalTasks?.length ??
          0;
        const s = (body.project as ProjectDocument | undefined)?.items?.length ?? 0;
        setMessage(
          `Datos actualizados desde GitHub (${n} tarea${n === 1 ? "" : "s"} general${n === 1 ? "" : "es"}, ${s} subtarea${s === 1 ? "" : "s"}).`,
        );
      }
      await loadIndex();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo traer de GitHub");
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
  if (hasToken && remote?.length) {
    // Con token: mostrar solo los remotos; anotar si ya están bajados localmente.
    const localById = new Map(local.map((p) => [p.projectId, p]));
    for (const p of remote) {
      const loc = localById.get(p.id);
      const suffix = loc
        ? loc.dirty
          ? " · cambios sin publicar"
          : " · sincronizado"
        : " · no descargado";
      selectOptions.push({ id: p.id, label: `${p.title} (#${p.number})${suffix}` });
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
          {project?.dirty ? (
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

        <button
          type="button"
          className="rk-btn rk-btn-primary"
          disabled={!selectedId || busy}
          onClick={() => void onPush()}
          title="updateProjectV2ItemFieldValue / createProjectV2Field"
        >
          Publicar en GitHub
        </button>
        <button
          type="button"
          className="rk-btn rk-btn-ghost"
          disabled={!selectedId || busy}
          onClick={() => void onPull(false)}
          title="Trae el Project remoto y sobrescribe el JSON local"
        >
          Traer de GitHub
        </button>
        {project?.dirty && (
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
            Elegí el demo o un Project de GitHub. Sin token la UI funciona con
            el JSON local: tareas, sprints y calendario.
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
            {TABS.map((t) => (
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

          {tab === "tareas" && (
            <section aria-label="Tareas y subtareas">
              <div className="rk-section-head">
                <h2 className="rk-section-title">
                  Tareas generales y subtareas
                </h2>
              </div>
              <HierarchyTable
                project={project}
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
            <SprintPanel project={project} onUpdate={onUpdateProject} />
          )}

          {tab === "calendario" && <CalendarView project={project} />}
        </>
      )}
    </div>
  );
}
