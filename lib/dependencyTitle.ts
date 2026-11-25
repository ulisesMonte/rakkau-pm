/**
 * @deprecated Legacy title suffix `-D` / `-d`.
 * Source of truth for bloqueos is GitHub Relationships (`blockedBy` / `blocking`)
 * — see `lib/issueRelations.ts`. Kept for fixtures and migration only.
 */

/** Título (trim) termina en `-D` o `-d`, con espacio opcional antes del sufijo. */
export function titleMarksDependency(title: string | null | undefined): boolean {
  const t = String(title ?? "").trim();
  if (!t) return false;
  return /\s*-D$/i.test(t);
}

/**
 * @deprecated Prefer `isBlockedByRelations` from `lib/issueRelations`.
 * Legacy: sufijo `-D`/`-d` o flag local `isDependency`.
 */
export function isDependencyRole(opts: {
  title?: string | null;
  isDependency?: boolean | null;
}): boolean {
  if (opts.isDependency) return true;
  return titleMarksDependency(opts.title);
}

/** @deprecated Prefer isDependencyRole para UI/filtro Dep. */
export function isDependencyEntity(opts: {
  title?: string | null;
  isDependency?: boolean | null;
  HasDependency?: string | null;
}): boolean {
  return isDependencyRole(opts);
}

/**
 * Aplica el rol dependencia al mapear desde GitHub / JSON local.
 * Sets `HasDependency: "Sí"` para reutilizar el filtro/columna existente (VIEW_ONLY-safe).
 */
export function applyDependencyFromTitle<T extends {
  title?: string | null;
  isDependency?: boolean;
  HasDependency?: string;
}>(entity: T): T {
  if (!titleMarksDependency(entity.title)) return entity;
  return {
    ...entity,
    isDependency: true,
    HasDependency:
      entity.HasDependency === "Sí" ? entity.HasDependency : "Sí",
  };
}
