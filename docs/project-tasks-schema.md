# Tasks: GitHub board ↔ Rakkau

Complementa [`project-fields-schema.md`](./project-fields-schema.md).

## Módulo

[`lib/github/projectTasksSchema.ts`](../lib/github/projectTasksSchema.ts)

| Tipo | Uso |
|------|-----|
| `GitHubProjectItemNode` | Fila del Project v2 en GraphQL |
| `mapGitHubProjectItems()` | Pull → `ProjectItem[]` plano (+ `parentIssueContentId`) |
| `mergeTasksAfterPush()` | Post-push: conserva `generalTasks` remotos + planificación local |
| `PROJECT_TASKS_SCHEMA_VERSION` | `ProjectDocument.tasksSchemaVersion` |

Jerarquía padre/hija: [`issueHierarchy.ts`](../lib/github/issueHierarchy.ts) (`rebuildProjectHierarchyFromGitHub`, `ensureGeneralTasksForSubtasks`).

Validación: [`projectInvariants.ts`](../lib/github/projectInvariants.ts) (`validateProjectHierarchy`, `normalizeProjectHierarchy`).

## Pull (orden)

1. Fields → `mapGitHubProjectFields`
2. Provision columnas UI → `ensureAllUiFieldsOnGitHub` ([`fieldProvisioning.ts`](../lib/github/fieldProvisioning.ts))
3. Items → `mapGitHubProjectItems(nodes, fields)`
4. `rebuildProjectHierarchyFromGitHub` → `generalTasks` + subtareas
5. `normalizeProjectHierarchy`

## Push

1. Provision columnas pendientes
2. Crear/sync drafts, sub-issues, field values
3. `pullProject` + `mergeTasksAfterPush` (no borrar padres)

## Valores dinámicos

Los valores de cada fila viven en `fieldValues` keyed por **nombre de columna** del catálogo `fields[]`. Las tareas generales duplican planificación en propiedades de `GeneralTask` y en columnas al publicar (`projectItemFromGeneralTask`).
