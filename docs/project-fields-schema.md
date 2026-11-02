# Esquema de columnas (Project fields)

Referencia para **GitHub Projects v2** ↔ JSON local ↔ migraciones.

## Módulo TypeScript

[`lib/github/projectFieldsSchema.ts`](../lib/github/projectFieldsSchema.ts)

| Concepto | Tipo / constante |
|----------|------------------|
| Versión del esquema en JSON | `PROJECT_FIELDS_SCHEMA_VERSION`, campo `ProjectDocument.fieldsSchemaVersion` |
| Nodo crudo de GitHub | `GitHubProjectFieldNode` |
| Columna local | `ProjectField` + `origin`, `canonicalKey` |
| Definición Rakkau | `CANONICAL_FIELD_DEFINITIONS` (Task, Blocked, Sprint, …) |
| Enlace negocio ↔ GitHub | `FieldBinding` (`canonicalKey` → `githubFieldId`) |
| Catálogo completo | `ProjectFieldsCatalog` |
| Diff para migrar | `FieldMigrationPlan` / `diffFieldCatalog(before, after)` |

## Flujo

1. **Pull** — `mapGitHubProjectFields` enriquece cada columna con `canonicalKey` y `origin: "github"`.
2. **Edición offline** — stubs `pendingCreate: true`, `origin: "local_pending"`.
3. **Push** — `mergeGitHubFieldCatalog(local, remote)` alinear ids; crear columnas pendientes; escribir valores por `dataType`.
4. **Migración JSON** — comparar `fields` viejos vs nuevos con `diffFieldCatalog`:
   - `id_replaced` — mismo nombre, distinto `PVTF_…` (re-pull o parche manual).
   - `data_type_changed` — revisar `fieldValues` en ítems.
   - `canonical_missing` — provisionar columnas Rakkau en GitHub.
   - `removed_on_github` — limpiar claves huérfanas en `fieldValues`.

## Valores en ítems

Los valores viven en `ProjectItem.fieldValues` / campos de `GeneralTask`, keyed por **nombre de columna GitHub** (no por `canonicalKey`, salvo que coincidan).

Helpers: [`lib/fieldValueCoerce.ts`](../lib/fieldValueCoerce.ts) (`asStringList`, `firstTaskId`).

## Tests

```bash
npm test
```

Suite: `lib/github/projectFieldsSchema.test.ts`.
