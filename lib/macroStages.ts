import type {
  CurrentQuarter,
  MacroTask,
  QuarterKey,
  StageObjective,
} from "@/lib/types";

export type StageProgress = {
  total: number;
  done: number;
  open: number;
  percent: number | null;
  /** Etapas vencidas y no cumplidas. */
  overdue: number;
};

/** Rango de fechas calendario de un Quarter (meses 0-index). */
export function quarterDateRange(
  quarter: QuarterKey,
  year: number,
): { start: string; end: string } {
  const q = Number(quarter.slice(1)) as 1 | 2 | 3 | 4;
  const startMonth = (q - 1) * 3;
  const endMonth = startMonth + 2;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, endMonth + 1, 0));
  return { start: isoDate(start), end: isoDate(end) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fechas de corte equiespaciadas en el Q (n etapas). */
export function suggestStageDueDates(
  quarter: QuarterKey,
  year: number,
  count: number,
): string[] {
  if (count <= 0) return [];
  const { start, end } = quarterDateRange(quarter, year);
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  if (count === 1) return [end];
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const t = startMs + ((endMs - startMs) * i) / count;
    out.push(isoDate(new Date(t)));
  }
  return out;
}

export function newStageId(): string {
  return `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newMacroId(): string {
  return `macro_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Crea N etapas vacías con vencimientos repartidos en el Q. */
export function createDefaultStages(
  quarter: QuarterKey,
  year: number,
  count = 4,
): StageObjective[] {
  const dues = suggestStageDueDates(quarter, year, count);
  return dues.map((dueDate, i) => ({
    id: newStageId(),
    name: `Etapa ${i + 1}`,
    objective: "",
    dueDate,
    done: false,
    doneAt: null,
  }));
}

export function stageProgress(stages: StageObjective[] | undefined): StageProgress {
  const list = stages ?? [];
  const total = list.length;
  if (total === 0) {
    return { total: 0, done: 0, open: 0, percent: null, overdue: 0 };
  }
  const today = isoDate(new Date());
  const done = list.filter((s) => s.done).length;
  const overdue = list.filter(
    (s) => !s.done && s.dueDate && s.dueDate < today,
  ).length;
  return {
    total,
    done,
    open: total - done,
    percent: Math.round((done / total) * 100),
    overdue,
  };
}

export function macrosForQuarter(
  macros: MacroTask[] | undefined,
  cq: CurrentQuarter | undefined,
): MacroTask[] {
  if (!macros?.length || !cq) return macros ?? [];
  return macros.filter((m) => m.quarter === cq.quarter && m.year === cq.year);
}

export function toggleStageDone(
  stage: StageObjective,
  done: boolean,
  now = new Date(),
): StageObjective {
  return {
    ...stage,
    done,
    doneAt: done ? now.toISOString() : null,
  };
}
