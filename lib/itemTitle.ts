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
