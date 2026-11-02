/** Coerción de valores en `ItemFieldValues` (GitHub devuelve TEXT y USER de formas distintas). */

export function asStringList(
  value: string | string[] | undefined | null,
): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.includes(",")) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [raw];
}

export function firstTaskId(
  task: string | string[] | undefined | null,
): string | null {
  const list = asStringList(task);
  return list[0] ?? null;
}
