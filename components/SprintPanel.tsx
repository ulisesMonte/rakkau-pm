"use client";

import { useMemo, useState } from "react";
import type {
  CurrentQuarter,
  ProjectDocument,
  QuarterKey,
  Sprint,
  SprintStatus,
} from "@/lib/types";
import { SPRINT_COLOR_PRESETS, sprintsRemainingInQuarter } from "@/lib/types";

interface SprintPanelProps {
  project: ProjectDocument;
  onUpdate: (patch: Partial<ProjectDocument>) => void;
}

const QUARTERS: QuarterKey[] = ["Q1", "Q2", "Q3", "Q4"];
const STATUSES: SprintStatus[] = ["planned", "active", "done"];

const STATUS_LABEL: Record<SprintStatus, string> = {
  planned: "Planificado",
  active: "En curso",
  done: "Listo",
};

function quarterFromDate(iso: string): { quarter: QuarterKey; year: number } {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    const q = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
    return { quarter: `Q${q}` as QuarterKey, year: now.getFullYear() };
  }
  const q = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { quarter: `Q${q}` as QuarterKey, year: d.getFullYear() };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  if (start && end) return `${start} → ${end}`;
  return start || end || "";
}

function nextPresetColor(existing: Sprint[]): string {
  const used = new Set(
    existing.map((s) => s.color?.toLowerCase()).filter(Boolean),
  );
  const free = SPRINT_COLOR_PRESETS.find(
    (c) => !used.has(c.toLowerCase()),
  );
  return free ?? SPRINT_COLOR_PRESETS[existing.length % SPRINT_COLOR_PRESETS.length];
}

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  return (
    <label className="rk-label rk-color-field">
      {label}
      <div className="rk-color-row">
        <input
          className="rk-color-input"
          type="color"
          value={value || "#2dd4bf"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <div className="rk-color-presets" role="list">
          {SPRINT_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`rk-color-swatch${
                value?.toLowerCase() === c.toLowerCase()
                  ? " rk-color-swatch-active"
                  : ""
              }`}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </div>
    </label>
  );
}

export function SprintPanel({ project, onUpdate }: SprintPanelProps) {
  const sprints = project.sprints ?? [];
  const cq = project.currentQuarter;
  const progress = sprintsRemainingInQuarter(sprints, cq);
  const pct =
    progress.total === 0
      ? 0
      : Math.round((progress.done / progress.total) * 100);

  const [draftName, setDraftName] = useState("");
  const [draftStart, setDraftStart] = useState(todayIso());
  const [draftEnd, setDraftEnd] = useState(addDays(todayIso(), 13));
  const [draftColor, setDraftColor] = useState(() =>
    nextPresetColor(sprints),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const inferred = useMemo(
    () => (draftStart ? quarterFromDate(draftStart) : null),
    [draftStart],
  );

  function setCurrentQuarter(next: CurrentQuarter) {
    onUpdate({ currentQuarter: next, dirty: true });
  }

  function createSprintByDates() {
    if (!draftStart || !draftEnd) {
      setFormError("Completá inicio y fin del sprint.");
      return;
    }
    if (draftEnd < draftStart) {
      setFormError("La fecha de fin no puede ser anterior al inicio.");
      return;
    }
    setFormError(null);
    const { quarter, year } = quarterFromDate(draftStart);
    const n =
      sprints.filter((s) => s.quarter === quarter && s.year === year).length +
      1;
    const sprint: Sprint = {
      id: `sp-${Date.now()}`,
      name: draftName.trim() || `Sprint ${n}`,
      quarter,
      year,
      status: "planned",
      startDate: draftStart,
      endDate: draftEnd,
      color: draftColor || nextPresetColor(sprints),
    };
    const nextList = [...sprints, sprint];
    onUpdate({ sprints: nextList, dirty: true });
    setDraftName("");
    setDraftStart(draftEnd);
    setDraftEnd(addDays(draftEnd, 13));
    setDraftColor(nextPresetColor(nextList));
  }

  function addQuickSprint() {
    const year = cq?.year ?? new Date().getFullYear();
    const quarter = cq?.quarter ?? "Q4";
    const n = sprints.filter((s) => s.quarter === quarter && s.year === year)
      .length;
    const last = [...sprints]
      .filter((s) => s.quarter === quarter && s.year === year && s.endDate)
      .sort((a, b) => (a.endDate! > b.endDate! ? -1 : 1))[0];
    const start = last?.endDate
      ? addDays(last.endDate, 1)
      : draftStart || todayIso();
    const end = addDays(start, 13);
    const color = nextPresetColor(sprints);
    const sprint: Sprint = {
      id: `sp-${Date.now()}`,
      name: `Sprint ${n + 1}`,
      quarter,
      year,
      status: "planned",
      startDate: start,
      endDate: end,
      color,
    };
    onUpdate({ sprints: [...sprints, sprint], dirty: true });
    setDraftColor(nextPresetColor([...sprints, sprint]));
  }

  function patchSprint(id: string, patch: Partial<Sprint>) {
    onUpdate({
      sprints: sprints.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        if (patch.startDate && !patch.quarter && !patch.year) {
          const qy = quarterFromDate(patch.startDate);
          next.quarter = qy.quarter;
          next.year = qy.year;
        }
        return next;
      }),
      dirty: true,
    });
  }

  function removeSprint(id: string) {
    onUpdate({
      sprints: sprints.filter((s) => s.id !== id),
      dirty: true,
    });
  }

  const sorted = [...sprints].sort((a, b) => {
    const as = a.startDate ?? "";
    const bs = b.startDate ?? "";
    if (as && bs) return as < bs ? -1 : as > bs ? 1 : 0;
    return a.name.localeCompare(b.name);
  });

  return (
    <section className="rk-sprint-panel" aria-label="Sprints y Quarter">
      <div className="rk-sprint-head">
        <h2 className="rk-section-title">Sprints y Quarter</h2>
        <div className="rk-sprint-cq">
          <label className="rk-label">
            Quarter actual
            <select
              className="rk-select-sm"
              value={cq?.quarter ?? "Q4"}
              onChange={(e) =>
                setCurrentQuarter({
                  quarter: e.target.value as QuarterKey,
                  year: cq?.year ?? new Date().getFullYear(),
                })
              }
            >
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className="rk-label">
            Año
            <input
              className="rk-input rk-input-year"
              type="number"
              value={cq?.year ?? new Date().getFullYear()}
              onChange={(e) =>
                setCurrentQuarter({
                  quarter: cq?.quarter ?? "Q4",
                  year: Number(e.target.value) || new Date().getFullYear(),
                })
              }
            />
          </label>
          <button
            type="button"
            className="rk-btn rk-btn-ghost"
            onClick={addQuickSprint}
            title="Crea el siguiente sprint del Q actual (14 días desde el último)"
          >
            + Rápido
          </button>
        </div>
      </div>

      <div className="rk-sprint-create" aria-label="Crear sprint por fechas">
        <p className="rk-sprint-create-hint">
          Crear por fechas
          {inferred
            ? ` · se asigna a ${inferred.quarter} ${inferred.year}`
            : ""}
        </p>
        <label className="rk-label">
          Nombre
          <input
            className="rk-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Sprint 5 (opcional)"
          />
        </label>
        <label className="rk-label">
          Inicio
          <input
            className="rk-input rk-input-date"
            type="date"
            value={draftStart}
            onChange={(e) => {
              const start = e.target.value;
              setDraftStart(start);
              if (start && (!draftEnd || draftEnd < start)) {
                setDraftEnd(addDays(start, 13));
              }
            }}
          />
        </label>
        <label className="rk-label">
          Fin
          <input
            className="rk-input rk-input-date"
            type="date"
            value={draftEnd}
            min={draftStart || undefined}
            onChange={(e) => setDraftEnd(e.target.value)}
          />
        </label>
        <ColorPicker
          label="Color"
          value={draftColor}
          onChange={setDraftColor}
        />
        <button
          type="button"
          className="rk-btn rk-btn-primary"
          onClick={createSprintByDates}
        >
          Crear sprint
        </button>
        {formError && (
          <p
            className="rk-sprint-create-hint"
            style={{ color: "var(--rk-magenta)" }}
          >
            {formError}
          </p>
        )}
      </div>

      <div className="rk-q-progress" role="status">
        <div className="rk-q-progress-meta">
          <span>
            {cq?.quarter} {cq?.year}:{" "}
            <strong>
              {progress.remaining} sprint
              {progress.remaining === 1 ? "" : "s"} por terminar
            </strong>{" "}
            de {progress.total}
          </span>
          <span className="rk-q-pct">{pct}%</span>
        </div>
        <div className="rk-q-bar" aria-hidden>
          <div className="rk-q-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ul className="rk-sprint-list">
        {sorted.length === 0 && (
          <li className="rk-sprint-empty">
            Todavía no hay sprints. Creá uno por fechas arriba.
          </li>
        )}
        {sorted.map((s) => (
          <li key={s.id} className={`rk-sprint-item rk-sprint-${s.status}`}>
            <input
              className="rk-color-input"
              type="color"
              value={s.color || "#2dd4bf"}
              onChange={(e) => patchSprint(s.id, { color: e.target.value })}
              aria-label={`Color ${s.name}`}
              title="Color del sprint en el calendario"
            />
            <input
              className="rk-input"
              value={s.name}
              onChange={(e) => patchSprint(s.id, { name: e.target.value })}
              aria-label="Nombre del sprint"
              title={formatRange(s.startDate, s.endDate)}
            />
            <select
              className="rk-select-sm"
              value={s.quarter}
              onChange={(e) =>
                patchSprint(s.id, { quarter: e.target.value as QuarterKey })
              }
              aria-label="Quarter del sprint"
            >
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <input
              className="rk-input rk-input-year"
              type="number"
              value={s.year}
              onChange={(e) =>
                patchSprint(s.id, {
                  year: Number(e.target.value) || s.year,
                })
              }
              aria-label="Año del sprint"
            />
            <label className="rk-label" style={{ margin: 0 }}>
              Inicio
              <input
                className="rk-input rk-input-date"
                type="date"
                value={s.startDate ?? ""}
                onChange={(e) =>
                  patchSprint(s.id, { startDate: e.target.value || undefined })
                }
                aria-label={`Inicio ${s.name}`}
              />
            </label>
            <label className="rk-label" style={{ margin: 0 }}>
              Fin
              <input
                className="rk-input rk-input-date"
                type="date"
                value={s.endDate ?? ""}
                min={s.startDate || undefined}
                onChange={(e) =>
                  patchSprint(s.id, { endDate: e.target.value || undefined })
                }
                aria-label={`Fin ${s.name}`}
              />
            </label>
            <select
              className="rk-select-sm"
              value={s.status}
              onChange={(e) =>
                patchSprint(s.id, { status: e.target.value as SprintStatus })
              }
              aria-label="Estado del sprint"
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rk-btn-icon"
              onClick={() => removeSprint(s.id)}
              title="Quitar sprint"
              aria-label="Quitar sprint"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
