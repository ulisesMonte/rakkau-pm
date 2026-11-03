"use client";

import { useMemo, useState } from "react";
import type {
  GeneralTask,
  MacroTask,
  ProjectDocument,
  StageObjective,
} from "@/lib/types";
import { currentCalendarQuarter } from "@/lib/types";
import {
  createDefaultStages,
  macrosForQuarter,
  newMacroId,
  newStageId,
  stageProgress,
  suggestStageDueDates,
  toggleStageDone,
} from "@/lib/macroStages";

type Props = {
  project: ProjectDocument;
  onUpdate: (patch: Partial<ProjectDocument>) => void;
  onPatchGeneralTask: (id: string, patch: Partial<GeneralTask>) => void;
};

export function MacroObjectivesPanel({
  project,
  onUpdate,
  onPatchGeneralTask,
}: Props) {
  const cq = project.currentQuarter ?? currentCalendarQuarter();
  const macros = useMemo(
    () => macrosForQuarter(project.macroTasks, cq),
    [project.macroTasks, cq],
  );
  const [draftTitle, setDraftTitle] = useState("");
  const [stageCount, setStageCount] = useState(4);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function setMacros(next: MacroTask[]) {
    const others = (project.macroTasks ?? []).filter(
      (m) => !(m.quarter === cq.quarter && m.year === cq.year),
    );
    onUpdate({
      macroTasks: [...others, ...next],
      dirty: true,
    });
  }

  function patchMacro(id: string, patch: Partial<MacroTask>) {
    setMacros(
      macros.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  function addMacro() {
    const title = draftTitle.trim();
    if (!title) return;
    const macro: MacroTask = {
      id: newMacroId(),
      title,
      quarter: cq.quarter,
      year: cq.year,
      stages: createDefaultStages(cq.quarter, cq.year, stageCount),
      EstadoOperativo: "a tiempo",
      generalTaskIds: [],
      createdAt: new Date().toISOString(),
    };
    setMacros([...macros, macro]);
    setDraftTitle("");
    setExpandedId(macro.id);
  }

  function removeMacro(id: string) {
    for (const gt of project.generalTasks) {
      if (gt.parentMacroId === id) {
        onPatchGeneralTask(gt.id, { parentMacroId: null });
      }
    }
    setMacros(macros.filter((m) => m.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  function addStage(macro: MacroTask) {
    const n = macro.stages.length + 1;
    const dues = suggestStageDueDates(macro.quarter, macro.year, n);
    const stages = macro.stages.map((s, i) => ({
      ...s,
      dueDate: dues[i] ?? s.dueDate,
    }));
    stages.push({
      id: newStageId(),
      name: `Etapa ${n}`,
      objective: "",
      dueDate: dues[n - 1] ?? dues[dues.length - 1] ?? "",
      done: false,
      doneAt: null,
    });
    patchMacro(macro.id, { stages });
  }

  function patchStage(
    macroId: string,
    stageId: string,
    patch: Partial<StageObjective>,
  ) {
    const macro = macros.find((m) => m.id === macroId);
    if (!macro) return;
    patchMacro(macroId, {
      stages: macro.stages.map((s) =>
        s.id === stageId ? { ...s, ...patch } : s,
      ),
    });
  }

  function removeStage(macroId: string, stageId: string) {
    const macro = macros.find((m) => m.id === macroId);
    if (!macro) return;
    patchMacro(macroId, {
      stages: macro.stages.filter((s) => s.id !== stageId),
    });
  }

  function linkGeneralTask(macroId: string, taskId: string) {
    const macro = macros.find((m) => m.id === macroId);
    if (!macro || !taskId) return;
    const ids = new Set(macro.generalTaskIds ?? []);
    ids.add(taskId);
    patchMacro(macroId, { generalTaskIds: Array.from(ids) });
    onPatchGeneralTask(taskId, { parentMacroId: macroId });
  }

  function unlinkGeneralTask(macroId: string, taskId: string) {
    const macro = macros.find((m) => m.id === macroId);
    if (!macro) return;
    patchMacro(macroId, {
      generalTaskIds: (macro.generalTaskIds ?? []).filter((id) => id !== taskId),
    });
    onPatchGeneralTask(taskId, { parentMacroId: null });
  }

  const unlinkedTasks = project.generalTasks.filter(
    (t) => !t.parentMacroId || !macros.some((m) => m.id === t.parentMacroId),
  );

  return (
    <div className="rk-macro-panel">
      <div className="rk-section-head">
        <div>
          <h2 className="rk-section-title">Objetivos del {cq.quarter} {cq.year}</h2>
          <p className="rk-section-sub">
            Macros con etapas: cada etapa tiene un objetivo y una fecha de
            vencimiento en el Q. Marcá si se cumplió.
          </p>
        </div>
      </div>

      <form
        className="rk-add-form rk-macro-add"
        onSubmit={(e) => {
          e.preventDefault();
          addMacro();
        }}
      >
        <input
          className="rk-input"
          placeholder="Nombre del objetivo / macro…"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          aria-label="Título del macro"
        />
        <label className="rk-macro-stages-count">
          Etapas
          <select
            className="rk-select-sm"
            value={stageCount}
            onChange={(e) => setStageCount(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rk-btn rk-btn-primary">
          Crear macro
        </button>
      </form>

      {macros.length === 0 && (
        <p className="rk-empty-inline">
          Todavía no hay macros en este Q. Creá uno para planificar objetivos por
          etapa.
        </p>
      )}

      <div className="rk-macro-list">
        {macros.map((macro) => {
          const prog = stageProgress(macro.stages);
          const open = expandedId === macro.id;
          const linked = project.generalTasks.filter(
            (t) =>
              t.parentMacroId === macro.id ||
              (macro.generalTaskIds ?? []).includes(t.id),
          );
          return (
            <article key={macro.id} className="rk-macro-card">
              <header className="rk-macro-card-head">
                <button
                  type="button"
                  className="rk-tree-toggle"
                  aria-expanded={open}
                  onClick={() =>
                    setExpandedId((id) => (id === macro.id ? null : macro.id))
                  }
                >
                  <span
                    className={`rk-tree-chevron${open ? " rk-tree-chevron-open" : ""}`}
                    aria-hidden
                  >
                    ▸
                  </span>
                </button>
                <div className="rk-macro-card-titles">
                  <input
                    className="rk-input rk-macro-title-input"
                    value={macro.title}
                    onChange={(e) =>
                      patchMacro(macro.id, { title: e.target.value })
                    }
                    aria-label="Título del macro"
                  />
                  <div className="rk-macro-meta">
                    <span className="rk-pill">
                      {macro.quarter} {macro.year}
                    </span>
                    {prog.percent != null && (
                      <span className="rk-pill">
                        Avance etapas {prog.percent}% ({prog.done}/{prog.total})
                      </span>
                    )}
                    {prog.overdue > 0 && (
                      <span className="rk-pill rk-pill-dirty">
                        {prog.overdue} vencida{prog.overdue === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="rk-pill">
                      {linked.length} tarea{linked.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {prog.percent != null && (
                    <div className="rk-progress rk-macro-progress">
                      <div className="rk-progress-track" aria-hidden>
                        <div
                          className="rk-progress-fill"
                          style={{ width: `${prog.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="rk-btn rk-btn-ghost"
                  onClick={() => removeMacro(macro.id)}
                >
                  Eliminar
                </button>
              </header>

              {open && (
                <div className="rk-macro-body">
                  <label className="rk-label">
                    Descripción
                    <textarea
                      className="rk-input"
                      rows={2}
                      value={macro.description ?? ""}
                      onChange={(e) =>
                        patchMacro(macro.id, { description: e.target.value })
                      }
                    />
                  </label>

                  <div className="rk-macro-stages-head">
                    <h3 className="rk-macro-subtitle">Etapas y objetivos</h3>
                    <button
                      type="button"
                      className="rk-btn rk-btn-ghost"
                      onClick={() => addStage(macro)}
                    >
                      + Etapa
                    </button>
                  </div>

                  <ul className="rk-stage-list">
                    {macro.stages.map((stage, idx) => {
                      const overdue =
                        !stage.done &&
                        stage.dueDate &&
                        stage.dueDate < new Date().toISOString().slice(0, 10);
                      return (
                        <li
                          key={stage.id}
                          className={`rk-stage-row${stage.done ? " rk-stage-done" : ""}${overdue ? " rk-stage-overdue" : ""}`}
                        >
                          <label className="rk-stage-check">
                            <input
                              type="checkbox"
                              checked={stage.done}
                              onChange={(e) =>
                                patchStage(
                                  macro.id,
                                  stage.id,
                                  toggleStageDone(stage, e.target.checked),
                                )
                              }
                              aria-label={`Cumplida etapa ${stage.name}`}
                            />
                          </label>
                          <div className="rk-stage-fields">
                            <div className="rk-stage-line">
                              <span className="rk-stage-idx">{idx + 1}</span>
                              <input
                                className="rk-input rk-stage-name"
                                value={stage.name}
                                onChange={(e) =>
                                  patchStage(macro.id, stage.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="Nombre de etapa"
                              />
                              <input
                                className="rk-input rk-input-date"
                                type="date"
                                value={stage.dueDate?.slice(0, 10) ?? ""}
                                onChange={(e) =>
                                  patchStage(macro.id, stage.id, {
                                    dueDate: e.target.value,
                                  })
                                }
                                aria-label="Vencimiento de etapa"
                              />
                              <button
                                type="button"
                                className="rk-btn rk-btn-ghost"
                                onClick={() => removeStage(macro.id, stage.id)}
                                title="Quitar etapa"
                              >
                                ×
                              </button>
                            </div>
                            <input
                              className="rk-input"
                              value={stage.objective}
                              onChange={(e) =>
                                patchStage(macro.id, stage.id, {
                                  objective: e.target.value,
                                })
                              }
                              placeholder="Objetivo de esta etapa…"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="rk-macro-links">
                    <h3 className="rk-macro-subtitle">Tareas generales vinculadas</h3>
                    {linked.length === 0 && (
                      <p className="rk-empty-inline">Ninguna todavía.</p>
                    )}
                    <ul className="rk-macro-link-list">
                      {linked.map((t) => (
                        <li key={t.id}>
                          <span className="rk-parent-id">{t.id}</span>
                          <span>{t.title}</span>
                          <button
                            type="button"
                            className="rk-btn rk-btn-ghost"
                            onClick={() => unlinkGeneralTask(macro.id, t.id)}
                          >
                            Desvincular
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="rk-label">
                      Vincular tarea
                      <select
                        className="rk-select-sm"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            linkGeneralTask(macro.id, e.target.value);
                          }
                        }}
                      >
                        <option value="">Elegí una tarea…</option>
                        {unlinkedTasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.id} — {t.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
