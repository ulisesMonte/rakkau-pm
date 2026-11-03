/**
 * Esquema de columnas ProjectV2: forma en GitHub ↔ modelo Rakkau ↔ migraciones.
 *
 * Flujo:
 * 1. Pull → `mapGitHubProjectFields(nodes)` → `ProjectField[]` con `origin` + `canonicalKey`
 * 2. Edición local → stubs `pendingCreate` / `origin: local_pending`
 * 3. Push → crear pendientes, `updateProjectV2ItemFieldValue` por `dataType`
 * 4. Migración → `diffFieldCatalog` + `FieldMigrationPlan` (renombres, tipo distinto, ids nuevos)
 */

import type {
  FieldDataType,
  FieldOption,
  ProjectField,
} from "@/lib/types";
import {
  BLOCKED_OPTIONS,
  CANONICAL_FIELDS,
  ESTADO_OPERATIVO_OPTIONS,
  RESPONSABLE_OPTIONS,
  QUARTER_OPTIONS,
  YES_NO_OPTIONS,
} from "@/lib/types";

/** Incrementar cuando cambie semántica de campos canónicos o bindings. */
export const PROJECT_FIELDS_SCHEMA_VERSION = 3;

export type CanonicalFieldKey =
  (typeof CANONICAL_FIELDS)[keyof typeof CANONICAL_FIELDS];

export type FieldOrigin = "github" | "local_pending";

/** Nodo field tal como viene del GraphQL de Projects v2 (subset estable). */
export interface GitHubProjectFieldNode {
  __typename?: string;
  id?: string;
  name?: string;
  dataType?: string;
  options?: Array<{
    id: string;
    name: string;
    color?: string;
    description?: string;
  }>;
}

/** Definición canónica Rakkau (nombre en GitHub + tipo esperado). */
export interface CanonicalFieldDefinition {
  key: CanonicalFieldKey;
  /** Nombre exacto de la columna en GitHub (hoy = key). */
  githubFieldName: string;
  dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT";
  /** Plantilla de opciones al provisionar SINGLE_SELECT. */
  singleSelectOptions?: FieldOption[];
}

export const CANONICAL_FIELD_DEFINITIONS: readonly CanonicalFieldDefinition[] =
  [
    { key: "Task", githubFieldName: CANONICAL_FIELDS.Task, dataType: "TEXT" },
    {
      key: "Blocked",
      githubFieldName: CANONICAL_FIELDS.Blocked,
      dataType: "SINGLE_SELECT",
      singleSelectOptions: BLOCKED_OPTIONS,
    },
    {
      key: "BlockedReason",
      githubFieldName: CANONICAL_FIELDS.BlockedReason,
      dataType: "TEXT",
    },
    {
      key: "HasDependency",
      githubFieldName: CANONICAL_FIELDS.HasDependency,
      dataType: "SINGLE_SELECT",
      singleSelectOptions: YES_NO_OPTIONS,
    },
    {
      key: "DependsOn",
      githubFieldName: CANONICAL_FIELDS.DependsOn,
      dataType: "TEXT",
    },
    { key: "Sprint", githubFieldName: CANONICAL_FIELDS.Sprint, dataType: "TEXT" },
    {
      key: "Quarter",
      githubFieldName: CANONICAL_FIELDS.Quarter,
      dataType: "SINGLE_SELECT",
      singleSelectOptions: QUARTER_OPTIONS,
    },
    {
      key: "DueDate",
      githubFieldName: CANONICAL_FIELDS.DueDate,
      dataType: "DATE",
    },
    {
      key: "Responsable",
      githubFieldName: CANONICAL_FIELDS.Responsable,
      dataType: "SINGLE_SELECT",
      singleSelectOptions: RESPONSABLE_OPTIONS,
    },
    {
      key: "EstadoOperativo",
      githubFieldName: CANONICAL_FIELDS.EstadoOperativo,
      dataType: "SINGLE_SELECT",
      singleSelectOptions: ESTADO_OPERATIVO_OPTIONS,
    },
  ] as const;

const CANONICAL_BY_GITHUB_NAME = new Map<string, CanonicalFieldKey>(
  CANONICAL_FIELD_DEFINITIONS.map((d) => [d.githubFieldName, d.key]),
);

const CANONICAL_DEF_BY_KEY = new Map<CanonicalFieldKey, CanonicalFieldDefinition>(
  CANONICAL_FIELD_DEFINITIONS.map((d) => [d.key, d]),
);

/** Campos nativos de GitHub (no los creamos nosotros; solo los reconocemos). */
export const GITHUB_BUILTIN_FIELD_NAMES = new Set<string>([
  "Title",
  "Status",
  "Assignees",
  "Labels",
  "Linked pull requests",
  "Milestone",
  "Repository",
  "Reviewers",
  "Parent issue",
  "Sub-issues progress",
  "Created",
  "Updated",
  "Closed",
]);

export type FieldBinding = {
  canonicalKey: CanonicalFieldKey;
  githubFieldId: string;
  githubFieldName: string;
  dataType: FieldDataType;
};

/** Snapshot para migrar JSON viejos o comparar pull con pull. */
export type ProjectFieldsCatalog = {
  schemaVersion: number;
  fields: ProjectField[];
  bindings: FieldBinding[];
};

export type FieldMigrationChange =
  | {
      kind: "added_on_github";
      name: string;
      fieldId: string;
      dataType: FieldDataType;
    }
  | {
      kind: "removed_on_github";
      name: string;
      fieldId: string;
    }
  | {
      kind: "id_replaced";
      name: string;
      oldId: string;
      newId: string;
    }
  | {
      kind: "data_type_changed";
      name: string;
      from: FieldDataType;
      to: FieldDataType;
    }
  | {
      kind: "canonical_missing";
      key: CanonicalFieldKey;
      expectedName: string;
    }
  | {
      kind: "pending_local";
      name: string;
      localId: string;
    };

export type FieldMigrationPlan = {
  schemaVersion: number;
  changes: FieldMigrationChange[];
  /** Acciones sugeridas (no ejecuta mutaciones). */
  suggestions: string[];
};

export function canonicalKeyForFieldName(
  name: string,
): CanonicalFieldKey | undefined {
  return CANONICAL_BY_GITHUB_NAME.get(name);
}

export function definitionForCanonicalKey(
  key: CanonicalFieldKey,
): CanonicalFieldDefinition | undefined {
  return CANONICAL_DEF_BY_KEY.get(key);
}

/** Enriquece metadata Rakkau sin mutar ids de GitHub. */
export function annotateProjectField(
  field: ProjectField,
): ProjectField {
  const canonicalKey = canonicalKeyForFieldName(field.name);
  const origin: FieldOrigin = field.pendingCreate ? "local_pending" : "github";
  return {
    ...field,
    ...(canonicalKey ? { canonicalKey } : {}),
    origin,
  };
}

export function mapGitHubProjectFieldNode(
  node: GitHubProjectFieldNode,
): ProjectField | null {
  if (!node.id || !node.name) return null;
  const base: ProjectField = {
    id: node.id,
    name: node.name,
    dataType: (node.dataType ?? "TEXT") as FieldDataType,
    options: node.options?.map(
      (o): FieldOption => ({
        id: o.id,
        name: o.name,
        color: o.color,
        description: o.description,
      }),
    ),
    pendingCreate: false,
  };
  return annotateProjectField(base);
}

export function mapGitHubProjectFields(
  nodes: GitHubProjectFieldNode[],
): ProjectField[] {
  return nodes
    .map(mapGitHubProjectFieldNode)
    .filter((f): f is ProjectField => f != null);
}

export function buildFieldBindings(fields: ProjectField[]): FieldBinding[] {
  const out: FieldBinding[] = [];
  for (const f of fields) {
    const key = f.canonicalKey ?? canonicalKeyForFieldName(f.name);
    if (!key || f.pendingCreate) continue;
    out.push({
      canonicalKey: key,
      githubFieldId: f.id,
      githubFieldName: f.name,
      dataType: f.dataType,
    });
  }
  return out;
}

export function buildFieldsCatalog(fields: ProjectField[]): ProjectFieldsCatalog {
  const annotated = fields.map((f) =>
    f.origin && (f.canonicalKey || !canonicalKeyForFieldName(f.name))
      ? f
      : annotateProjectField(f),
  );
  return {
    schemaVersion: PROJECT_FIELDS_SCHEMA_VERSION,
    fields: annotated,
    bindings: buildFieldBindings(annotated),
  };
}

export function findFieldByCanonical(
  fields: ProjectField[],
  key: CanonicalFieldKey,
): ProjectField | undefined {
  const def = definitionForCanonicalKey(key);
  const expectedName = def?.githubFieldName ?? key;
  return fields.find(
    (f) =>
      f.canonicalKey === key ||
      f.name === expectedName ||
      f.name === key,
  );
}

export function findFieldByName(
  fields: ProjectField[],
  name: string,
): ProjectField | undefined {
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase() === lower);
}

/**
 * Fusiona catálogo local con fields recién traídos de GitHub.
 * - Conserva ids reales de GitHub por nombre (case-insensitive).
 * - Descarta stubs `pendingCreate` si GitHub ya tiene esa columna.
 * - Añade columnas nuevas remotas.
 */
export function mergeGitHubFieldCatalog(
  localFields: ProjectField[],
  remoteFields: ProjectField[],
): ProjectField[] {
  const remoteByName = new Map(
    remoteFields.map((f) => [f.name.toLowerCase(), annotateProjectField(f)]),
  );
  const merged: ProjectField[] = [];
  const seen = new Set<string>();

  for (const f of localFields) {
    const remote = remoteByName.get(f.name.toLowerCase());
    if (remote) {
      const key = remote.name.toLowerCase();
      if (!seen.has(key)) {
        merged.push(remote);
        seen.add(key);
      }
      continue;
    }
    if (f.pendingCreate) continue;
    const key = f.name.toLowerCase();
    if (seen.has(key)) continue;
    merged.push(annotateProjectField({ ...f, pendingCreate: false }));
    seen.add(key);
  }

  for (const rf of remoteFields) {
    const key = rf.name.toLowerCase();
    if (!seen.has(key)) {
      merged.push(annotateProjectField(rf));
      seen.add(key);
    }
  }

  return merged;
}

/** Compara dos catálogos (p. ej. JSON guardado vs pull) para migraciones. */
export function diffFieldCatalog(
  before: ProjectField[],
  after: ProjectField[],
): FieldMigrationPlan {
  const changes: FieldMigrationChange[] = [];
  const suggestions: string[] = [];

  const beforeById = new Map(before.map((f) => [f.id, f]));
  const afterById = new Map(after.map((f) => [f.id, f]));
  const beforeByName = new Map(before.map((f) => [f.name.toLowerCase(), f]));
  const afterByName = new Map(after.map((f) => [f.name.toLowerCase(), f]));

  for (const f of after) {
    if (f.pendingCreate) continue;
    const prev = beforeByName.get(f.name.toLowerCase());
    if (!prev) {
      changes.push({
        kind: "added_on_github",
        name: f.name,
        fieldId: f.id,
        dataType: f.dataType,
      });
      continue;
    }
    if (prev.id !== f.id) {
      changes.push({
        kind: "id_replaced",
        name: f.name,
        oldId: prev.id,
        newId: f.id,
      });
      suggestions.push(
        `Columna «${f.name}»: actualizar field id ${prev.id} → ${f.id} en JSON local.`,
      );
    }
    if (prev.dataType !== f.dataType) {
      changes.push({
        kind: "data_type_changed",
        name: f.name,
        from: prev.dataType,
        to: f.dataType,
      });
      suggestions.push(
        `Columna «${f.name}»: tipo ${prev.dataType} → ${f.dataType}; revisar valores en ítems.`,
      );
    }
  }

  for (const f of before) {
    if (f.pendingCreate) {
      changes.push({
        kind: "pending_local",
        name: f.name,
        localId: f.id,
      });
      continue;
    }
    if (!afterByName.has(f.name.toLowerCase()) && !afterById.has(f.id)) {
      changes.push({
        kind: "removed_on_github",
        name: f.name,
        fieldId: f.id,
      });
      suggestions.push(
        `Columna «${f.name}» ya no está en GitHub; limpiar fieldValues.${f.name} o restaurar columna.`,
      );
    }
  }

  for (const def of CANONICAL_FIELD_DEFINITIONS) {
    const hit = findFieldByCanonical(after, def.key);
    if (!hit || hit.pendingCreate) {
      changes.push({
        kind: "canonical_missing",
        key: def.key,
        expectedName: def.githubFieldName,
      });
    }
  }

  if (
    changes.some((c) => c.kind === "canonical_missing") &&
    !suggestions.some((s) => s.includes("provision"))
  ) {
    suggestions.push(
      "Ejecutá pull con token o POST provision: faltan columnas canónicas Rakkau en el Project.",
    );
  }

  return {
    schemaVersion: PROJECT_FIELDS_SCHEMA_VERSION,
    changes,
    suggestions,
  };
}

/** Specs para `provisionCanonicalFields` / createField. */
export function canonicalFieldsCreateSpecs(): Array<{
  name: string;
  dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT";
  singleSelectOptions?: Array<{
    name: string;
    color: string;
    description: string;
  }>;
}> {
  return CANONICAL_FIELD_DEFINITIONS.map((d) => ({
    name: d.githubFieldName,
    dataType: d.dataType,
    singleSelectOptions: d.singleSelectOptions?.map((o) => ({
      name: o.name,
      color: o.color ?? "GRAY",
      description: o.description ?? "",
    })),
  }));
}
