import type { ItemFieldValues, ProjectItem } from "@/lib/types";

const PLACEHOLDER = "(sin título)";

function titleFromFieldValues(fv: ItemFieldValues | undefined): string {
  const raw = fv?.Title;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim();
  return "";
}

/** Título visible: content/issue, columna Title de GitHub Projects, o fallback. */
export function itemDisplayTitle(
  item: Pick<ProjectItem, "title" | "fieldValues" | "number">,
): string {
  const fromContent = (item.title ?? "").trim();
  if (fromContent && fromContent !== PLACEHOLDER) return fromContent;
  const fromField = titleFromFieldValues(item.fieldValues);
  if (fromField) return fromField;
  if (item.number != null) return `#${item.number}`;
  return PLACEHOLDER;
}

/** Título para mutaciones a GitHub (issue/draft). */
export function itemTitleForSync(item: ProjectItem): string | null {
  const t = itemDisplayTitle(item);
  return t === PLACEHOLDER ? null : t;
}

export function isPlaceholderTitle(title: string | undefined | null): boolean {
  return !title?.trim() || title.trim() === PLACEHOLDER;
}

/** Título que termina en `-D` / `-d` (nomenclatura de dependencia). */
export function isDependencyTitle(title: string | undefined | null): boolean {
  return /-d$/i.test((title ?? "").trim());
}

/**
 * Responsable distinto de rakkau (p. ej. cliente u otra opción del Project).
 * Vacío / ausente no cuenta.
 */
export function isExternalResponsable(
  responsable: string | undefined | null,
): boolean {
  const v = (responsable ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v === "rakkau") return false;
  // Alias histórico visto en boards
  if (v === "fcliente") return true;
  return true;
}

/** Clases de fila: wash cyan si `-D`; sky si Responsable ≠ rakkau; ambos si aplica. */
export function titleNomenclatureRowClasses(
  title: string | undefined | null,
  responsable?: string | null,
): string {
  const parts: string[] = [];
  if (isDependencyTitle(title)) parts.push("rk-row-has-dep");
  if (isExternalResponsable(responsable)) parts.push("rk-row-resp-external");
  return parts.length ? ` ${parts.join(" ")}` : "";
}
