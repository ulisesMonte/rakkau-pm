/** GitHub Projects Status (Todo / Done / …) + legacy issue OPEN/CLOSED. */

export function githubProjectStatusClosed(status: string): boolean {
  const t = status.trim();
  if (!t) return false;
  if (/^closed$/i.test(t) || t.toUpperCase() === "CLOSED") return true;
  return /^(done|cerrad)/i.test(t);
}

export function taskStatusDisplay(
  projectStatus?: string,
  issueState?: string,
): { text: string; open: boolean } {
  if (typeof projectStatus === "string" && projectStatus.trim()) {
    const t = projectStatus.trim();
    return { text: t, open: !githubProjectStatusClosed(t) };
  }
  const s = String(issueState ?? "OPEN").toUpperCase();
  if (s === "CLOSED") return { text: "Cerrada", open: false };
  return { text: "Abierta", open: true };
}

/** Para filtros `is:open` / vencimiento próximo. */
export function isActiveTaskStatus(
  projectStatus?: string,
  issueState?: string,
): boolean {
  if (typeof projectStatus === "string" && projectStatus.trim()) {
    return !githubProjectStatusClosed(projectStatus);
  }
  const s = String(issueState ?? "OPEN").toUpperCase();
  return s === "OPEN" || s === "DRAFT" || s === "";
}

export function issueStateFromProjectStatus(
  projectStatus: string,
): "OPEN" | "CLOSED" {
  return githubProjectStatusClosed(projectStatus) ? "CLOSED" : "OPEN";
}
