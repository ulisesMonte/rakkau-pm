import type { ResponsableValue } from "@/lib/types";

/**
 * Normaliza Responsable a `rakkau` | `cliente`.
 * "fcliente" (typo / alias) → `cliente`. Vacío / desconocido → "".
 */
export function normalizeResponsableValue(
  raw: string | null | undefined,
): ResponsableValue {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (v === "rakkau") return "rakkau";
  if (v === "cliente" || v === "fcliente") return "cliente";
  return "";
}

export function isResponsableValue(
  raw: string | null | undefined,
): raw is Exclude<ResponsableValue, ""> {
  const v = normalizeResponsableValue(raw);
  return v === "rakkau" || v === "cliente";
}
