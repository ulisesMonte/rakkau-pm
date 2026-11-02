"use client";

import { useMemo, useState } from "react";
import type { ProjectDocument, QuarterKey, Sprint } from "@/lib/types";
import { SPRINT_COLOR_PRESETS } from "@/lib/types";
import { itemDisplayTitle } from "@/lib/itemTitle";

interface CalendarViewProps {
  project: ProjectDocument;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

function quarterBounds(quarter: QuarterKey, year: number): {
  start: string;
  end: string;
} {
  const startMonth = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }[quarter];
  const start = toIso(year, startMonth, 1);
  const endMonth = startMonth + 2;
  const endDay = new Date(year, endMonth + 1, 0).getDate();
  const end = toIso(year, endMonth, endDay);
  return { start, end };
}

function monthLabel(y: number, m0: number): string {
  const raw = new Date(y, m0, 1).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function inRange(day: string, start?: string, end?: string): boolean {
  if (!start || !end) return false;
  return day >= start && day <= end;
}

function formatEs(iso: string): string {
  try {
    return parseFriendly(iso);
  } catch {
    return iso;
  }
}

function parseFriendly(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length !== 6) return `rgba(45, 212, 191, ${alpha})`;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sprintColor(s: Sprint, index: number): string {
  return s.color || SPRINT_COLOR_PRESETS[index % SPRINT_COLOR_PRESETS.length];
}

export function CalendarView({ project }: CalendarViewProps) {
  const cq = project.currentQuarter;
  const initial = useMemo(() => {
    if (cq) {
      const m0 = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }[cq.quarter];
      return { year: cq.year, month: m0 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [cq]);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);

  const today = new Date().toISOString().slice(0, 10);

  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const startPad = (first.getDay() + 6) % 7;
    const dim = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < startPad; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= dim; d++) {
      cells.push({ iso: toIso(year, month, d), day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
    return cells;
  }, [year, month]);

  type DueEntry = {
    key: string;
    label: string;
    kind: "task" | "subtask";
  };

  const dueByDay = useMemo(() => {
    const map = new Map<string, DueEntry[]>();
    for (const task of project.generalTasks) {
      const due = task.DueDate?.slice(0, 10);
      if (!due) continue;
      const list = map.get(due) ?? [];
      list.push({
        key: `task-${task.id}`,
        label: `${task.id} ${task.title}`,
        kind: "task",
      });
      map.set(due, list);
    }
    for (const item of project.items) {
      const due = item.fieldValues.DueDate?.slice(0, 10);
      if (!due) continue;
      const list = map.get(due) ?? [];
      list.push({
        key: item.nodeId,
        label: `${item.number != null ? `#${item.number} ` : ""}${itemDisplayTitle(item)}`,
        kind: "subtask",
      });
      map.set(due, list);
    }
    return map;
  }, [project.generalTasks, project.items]);

  const sprints = project.sprints ?? [];
  const sprintIndex = useMemo(() => {
    const m = new Map<string, number>();
    sprints.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [sprints]);

  const activeQuarter = useMemo(() => {
    if (cq) {
      const b = quarterBounds(cq.quarter, cq.year);
      return {
        key: `${cq.quarter}-${cq.year}`,
        label: `${cq.quarter} ${cq.year}`,
        ...b,
      };
    }
    const qNum = (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
    const qKey = `Q${qNum}` as QuarterKey;
    const b = quarterBounds(qKey, year);
    return { key: `${qKey}-${year}`, label: `${qKey} ${year}`, ...b };
  }, [cq, month, year]);

  const monthSprints = useMemo(() => {
    const monthStart = toIso(year, month, 1);
    const monthEnd = toIso(year, month, new Date(year, month + 1, 0).getDate());
    return sprints.filter((s) => {
      if (!s.startDate || !s.endDate) return false;
      return s.startDate <= monthEnd && s.endDate >= monthStart;
    });
  }, [sprints, year, month]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  function sprintCovering(iso: string): Sprint | undefined {
    return sprints.find((s) => inRange(iso, s.startDate, s.endDate));
  }

  const undatedTasks = project.generalTasks.filter((t) => !t.DueDate);
  const undated = project.items.filter((i) => !i.fieldValues.DueDate);

  return (
    <section className="rk-calendar" aria-label="Calendario">
      <div className="rk-section-head">
        <h2 className="rk-section-title">Calendario</h2>
        <div className="rk-cal-nav">
          <button type="button" className="rk-btn rk-btn-ghost" onClick={prevMonth}>
            ←
          </button>
          <span className="rk-cal-month">{monthLabel(year, month)}</span>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={nextMonth}>
            →
          </button>
        </div>
      </div>

      <div className="rk-cal-layout">
        <aside className="rk-cal-side" aria-label="Quarter y sprints">
          <div className="rk-cal-side-card rk-cal-side-q">
            <div className="rk-cal-side-label">Quarter</div>
            <div className="rk-cal-side-title">{activeQuarter.label}</div>
            <div className="rk-cal-side-range">
              {formatEs(activeQuarter.start)} → {formatEs(activeQuarter.end)}
            </div>
            <div className="rk-cal-side-hint">
              Arranque marcado en el calendario ·{" "}
              {formatEs(activeQuarter.start)}
            </div>
          </div>

          <div className="rk-cal-side-card">
            <div className="rk-cal-side-label">Sprints del mes</div>
            {monthSprints.length === 0 && (
              <p className="rk-muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                Ninguno con fechas en este mes.
              </p>
            )}
            <ul className="rk-cal-sprint-legend">
              {monthSprints.map((s) => {
                const color = sprintColor(s, sprintIndex.get(s.id) ?? 0);
                return (
                  <li key={s.id}>
                    <span
                      className="rk-cal-swatch"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <div>
                      <strong>{s.name}</strong>
                      <div className="rk-cal-side-range">
                        {s.startDate && s.endDate
                          ? `${formatEs(s.startDate)} → ${formatEs(s.endDate)}`
                          : "Sin fechas"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rk-cal-legend rk-cal-legend-compact">
            <span className="rk-cal-leg rk-cal-leg-due">Vencimiento</span>
            <span className="rk-cal-leg rk-cal-leg-qstart">Inicio Q</span>
          </div>
        </aside>

        <div className="rk-cal-grid" role="grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="rk-cal-dow" role="columnheader">
              {w}
            </div>
          ))}
          {days.map((cell, idx) => {
            if (!cell.iso) {
              return (
                <div key={`e-${idx}`} className="rk-cal-cell rk-cal-empty" />
              );
            }
            const dues = dueByDay.get(cell.iso) ?? [];
            const sp = sprintCovering(cell.iso);
            const spColor = sp
              ? sprintColor(sp, sprintIndex.get(sp.id) ?? 0)
              : null;
            const isSprintStart = Boolean(sp?.startDate === cell.iso);
            const isQStart = activeQuarter.start === cell.iso;
            const isToday = cell.iso === today;
            const tintStyle = spColor
              ? {
                  background: `linear-gradient(180deg, ${hexToRgba(
                    spColor,
                    0.22,
                  )}, ${hexToRgba(spColor, 0.08)} 55%, var(--rk-bg-elevated))`,
                  boxShadow: `inset 3px 0 0 ${spColor}`,
                }
              : undefined;

            return (
              <div
                key={cell.iso}
                className={`rk-cal-cell${isToday ? " rk-cal-today" : ""}${
                  dues.length ? " rk-cal-has-due" : ""
                }`}
                style={tintStyle}
                role="gridcell"
                title={
                  sp
                    ? `${sp.name}${sp.startDate && sp.endDate ? ` · ${sp.startDate} → ${sp.endDate}` : ""}`
                    : undefined
                }
              >
                <div className="rk-cal-daynum">{cell.day}</div>
                {isQStart && (
                  <div className="rk-cal-chip rk-cal-chip-qstart">
                    Inicio {activeQuarter.label}
                  </div>
                )}
                {isSprintStart && sp && (
                  <div
                    className="rk-cal-chip rk-cal-chip-sprint-start"
                    style={{
                      borderColor: spColor ?? undefined,
                      color: spColor ?? undefined,
                      background: spColor
                        ? hexToRgba(spColor, 0.18)
                        : undefined,
                    }}
                  >
                    {sp.name}
                  </div>
                )}
                {dues.map((entry) => (
                  <div
                    key={entry.key}
                    className={`rk-cal-chip rk-cal-chip-due${
                      entry.kind === "task" ? " rk-cal-chip-due-task" : ""
                    }`}
                    title={entry.label}
                  >
                    {entry.kind === "task" ? "T · " : ""}
                    {entry.label.length > 18
                      ? `${entry.label.slice(0, 18)}…`
                      : entry.label}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {(undatedTasks.length > 0 || undated.length > 0) && (
        <div className="rk-cal-undated">
          <h3 className="rk-section-title" style={{ fontSize: "1rem" }}>
            Sin vencimiento
          </h3>
          <ul>
            {undatedTasks.map((t) => (
              <li key={t.id}>
                Tarea · {t.id} {t.title}
              </li>
            ))}
            {undated.map((item) => (
              <li key={item.nodeId}>
                Subtarea ·{" "}
                {item.number != null ? `#${item.number} ` : ""}
                {itemDisplayTitle(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
