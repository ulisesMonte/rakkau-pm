"use client";

import { useMemo, useState } from "react";
import type { ProjectDocument } from "@/lib/types";
import {
  computeProjectProgressStats,
  type ProgressScope,
  type StatBucket,
} from "@/lib/projectProgressStats";
import {
  formatProgressFraction,
  type GeneralTaskProgress,
} from "@/lib/taskProgress";
import { progressFillClass } from "@/lib/progressView";

function MiniBar({ progress }: { progress: GeneralTaskProgress }) {
  if (progress.percent == null) {
    return <span className="rk-muted">—</span>;
  }
  return (
    <div
      className="rk-progress rk-progress-col rk-progress-fraction rk-stats-bar"
      title={`${progress.done} de ${progress.total} subtareas`}
    >
      <div className="rk-progress-track" aria-hidden>
        <div
          className={`rk-progress-fill ${progressFillClass(progress)}`.trim()}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className="rk-progress-label">
        {formatProgressFraction(progress)}
      </span>
    </div>
  );
}

function BucketRow({
  title,
  buckets,
}: {
  title: string;
  buckets: StatBucket[];
}) {
  if (!buckets.length) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="rk-stats-cut">
      <p className="rk-stats-cut-title">{title}</p>
      <ul className="rk-stats-cut-list">
        {buckets.map((b) => (
          <li key={b.key} className="rk-stats-cut-item">
            <span className="rk-stats-cut-label" title={b.label}>
              {b.label}
            </span>
            <span className="rk-stats-cut-track" aria-hidden>
              <span
                className="rk-stats-cut-fill"
                style={{ width: `${Math.round((b.count / max) * 100)}%` }}
              />
            </span>
            <span className="rk-stats-cut-count">{b.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectProgressSummary({
  project,
}: {
  project: ProjectDocument;
}) {
  const [scope, setScope] = useState<ProgressScope>("active");
  const stats = useMemo(
    () => computeProjectProgressStats(project, scope),
    [project, scope],
  );

  return (
    <section className="rk-stats" aria-label="Resumen de progreso del proyecto">
      <header className="rk-stats-head">
        <div>
          <p className="rk-stats-kicker">Progreso del proyecto</p>
          <h3 className="rk-stats-title">
            {scope === "active" ? "Trabajo activo" : "Todo el board"}
          </h3>
        </div>
        <div
          className="rk-stats-toggle"
          role="group"
          aria-label="Alcance del resumen"
        >
          <button
            type="button"
            className={`rk-stats-toggle-btn${scope === "active" ? " rk-stats-toggle-on" : ""}`}
            onClick={() => setScope("active")}
          >
            Activos
          </button>
          <button
            type="button"
            className={`rk-stats-toggle-btn${scope === "all" ? " rk-stats-toggle-on" : ""}`}
            onClick={() => setScope("all")}
          >
            Todo
          </button>
        </div>
      </header>

      <div className="rk-stats-hero">
        <div className="rk-stats-metric">
          <span className="rk-stats-metric-label">En vista</span>
          <span className="rk-stats-metric-value">{stats.totalInScope}</span>
          <span className="rk-stats-metric-hint">
            {scope === "active"
              ? `de ${stats.boardTotal} en el board · ${stats.doneHistoric} Done`
              : `${stats.activeTotal} activos · ${stats.doneHistoric} Done`}
          </span>
        </div>
        <div className="rk-stats-metric rk-stats-metric-wide">
          <span className="rk-stats-metric-label">
            Avance (sub-issues
            {stats.parentsWithSubIssues
              ? ` · ${stats.parentsWithSubIssues} padres`
              : ""}
            )
          </span>
          <MiniBar progress={stats.subIssuesRollup} />
          <span className="rk-stats-metric-hint">
            Suma de subtareas de padres
            {scope === "active" ? " activos" : ""} con jerarquía
          </span>
        </div>
      </div>

      <div className="rk-stats-grid">
        <BucketRow title="Por Status" buckets={stats.byStatus} />
        <BucketRow title="Por tipo" buckets={stats.byIssueType} />
        <BucketRow title="Por scope" buckets={stats.byScopeLabel} />
        <BucketRow title="Por kind / label" buckets={stats.byKindLabel} />
        <BucketRow title="Asignados" buckets={stats.byAssignee} />
      </div>

      {stats.focus.length > 0 && (
        <div className="rk-stats-focus">
          <p className="rk-stats-cut-title">Foco (menor avance primero)</p>
          <ul className="rk-stats-focus-list">
            {stats.focus.map((f) => (
              <li key={f.id} className="rk-stats-focus-item">
                <div className="rk-stats-focus-main">
                  {f.issueNumber != null ? (
                    <span className="rk-sub-issue">#{f.issueNumber}</span>
                  ) : null}
                  <span className="rk-stats-focus-title" title={f.title}>
                    {f.title}
                  </span>
                  {f.status ? (
                    <span className="rk-stats-focus-status">{f.status}</span>
                  ) : null}
                </div>
                <MiniBar progress={f.progress} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
