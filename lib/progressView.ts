import type { GeneralTaskProgress } from "@/lib/taskProgress";

/** Tono de barra / semáforo según % de avance. */
export function progressTone(
  percent: number | null | undefined,
): "empty" | "low" | "mid" | "good" {
  if (percent == null || Number.isNaN(percent)) return "empty";
  if (percent >= 70) return "good";
  if (percent >= 30) return "mid";
  return "low";
}

export function progressFillClass(progress: GeneralTaskProgress): string {
  const tone = progressTone(progress.percent);
  if (tone === "empty") return "";
  return `rk-progress-fill--${tone}`;
}

/** Status GitHub «Bloqueado» = bloqueo operativo (sin columna Blocked). */
export function statusIsBlocked(status?: string | null): boolean {
  return /^bloqueado$/i.test(String(status ?? "").trim());
}
