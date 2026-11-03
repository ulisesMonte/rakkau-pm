# Contexto del proyecto — Rakkau Ops Platform

Documento de referencia para desarrollo, revisiones y pruebas E2E. La UI está en **español**; el código y commits en inglés están bien.

## Qué es

PoC de planilla operativa Rakkau sobre **GitHub Projects v2**, sin base de datos:

- Fuente de verdad remota: **Project v2 + issues** en GitHub.
- Copia local: JSON en `data/projects/<projectId>.json`.
- Flujo operativo: **Traer de GitHub** → editar en UI → **Publicar en GitHub**.

Jerarquía: **tarea general** (iniciativa / ID de negocio) → **subtareas** (issues enlazadas como sub-issues en el repo configurado).

## Arranque y entorno

```bash
npm install
cp .env.example .env.local   # GH_TOKEN; GH_ISSUE_REPOSITORY es fallback opcional
npm run dev                  # http://localhost:3000
npm test                     # vitest unitario
```

| Variable | Uso |
|----------|-----|
| `GH_TOKEN` | PAT classic, scope `project` (+ `repo` si issues privados). **Solo servidor**, nunca en JSON ni client. |
| `GH_ISSUE_REPOSITORY` | Fallback opcional `owner/repo`. **La UI «Repo de issues»** (persistida en el JSON del project / index) tiene prioridad al publicar. |

### Repo de issues (dinámico)

- Al **listar / traer** Projects se descubren repos vinculados al Project v2 (y, si hace falta, URLs de ítems / owner).
- Quedan en `ProjectDocument.availableRepositories` y alimentan un **`<select>` de GitHub** («Repo de issues»): solo opciones traídas de GitHub, no texto libre.
- La elección del usuario vive en `issueRepository` (también espejada en `index.json`).
- Al **publicar**, `resolveIssueRepositoryId` usa: UI → env fallback → discovery.

Sin token: UI offline con fixtures (`PVT_kwDODEMO_*` no hace push real).

## Lab E2E (GitHub real)

| Item | Valor |
|------|--------|
| Project | CIAM Ops Hybrid Test — `PVT_kwHOB_sFhs4BpSjO` |
| URL | https://github.com/users/ulisesMonte/projects/3 |
| JSON local | `data/projects/PVT_kwHOB_sFhs4BpSjO.json` |
| Repo issues | `ulisesMonte/ciam-ops-hybrid-test` |

Prueba E2E: baseline en GitHub → pull → editar campos → push → pull verificación. Plantilla de evidencias: [`e2e-github-sync-evidence.md`](./e2e-github-sync-evidence.md). Snapshots opcionales: `test-fixtures/e2e-runs/<fecha>/`.

## Modelo de datos (resumen)

### `ProjectDocument`

- `fields[]` — catálogo de columnas del Project (GitHub + `pendingCreate` local).
- `generalTasks[]` — tareas generales (planificación + refs GitHub).
- `items[]` — subtareas / filas hijas (`fieldValues`, `parentTaskId`, `parentIssueContentId`).
- `dirty` — cambios locales no publicados; pull sin `force` falla si `dirty: true`.
- `fieldsSchemaVersion` / `tasksSchemaVersion` — migraciones de esquema.

### Campos canónicos Rakkau → columna GitHub

| Negocio | Nombre columna | Dónde en local (tarea general) |
|---------|----------------|--------------------------------|
| ID iniciativa | `Task` | `GeneralTask.id` + column Task |
| Dependencia | `HasDependency`, `DependsOn` | props `GeneralTask` |
| Planificación | `Sprint`, `Quarter`, `DueDate` | props `GeneralTask` |
| Bloqueo | `Blocked`, `BlockedReason` | props; bloqueo también vía Status «Bloqueado» |
| Custom (ej.) | `Track / Journey` | `GeneralTask.githubFieldValues["Track / Journey"]` |

Subtareas: todo en `ProjectItem.fieldValues` keyed por **nombre de columna**.

Detalle: [`project-fields-schema.md`](./project-fields-schema.md), [`project-tasks-schema.md`](./project-tasks-schema.md).

## Mapa de código

| Área | Archivos |
|------|----------|
| Tipos | `lib/types.ts` (`CANONICAL_FIELDS`, `GeneralTask`, `ProjectItem`) |
| Pull / push GraphQL | `lib/github/graphql.ts` |
| Columnas ↔ GitHub | `lib/github/projectFieldsSchema.ts`, `fieldProvisioning.ts` |
| Ítems ↔ board | `lib/github/projectTasksSchema.ts` (`mapGitHubProjectItems`, `mergeTasksAfterPush`) |
| Jerarquía padre/hijo + repo issues | `lib/github/issueHierarchy.ts` (`discoverIssueRepositories`, `resolveIssueRepositoryId`) |
| Sync campos padre | `lib/github/generalTaskFields.ts` |
| Invariantes | `lib/github/projectInvariants.ts` |
| UI tabla + panel | `components/HierarchyTable.tsx`, `OpsDashboard.tsx` |
| Columnas UI | `lib/githubTableColumns.ts` |
| Persistencia | `lib/fs/store.ts`, `app/api/projects/[projectId]/*` |

### Pipeline pull (orden)

1. `mapGitHubProjectFields` → `fields[]`
2. `ensureAllUiFieldsOnGitHub` (provision columnas)
3. `mapGitHubProjectItems` → `items[]`
4. `rebuildProjectHierarchyFromGitHub` → `generalTasks[]` + subtareas
5. `normalizeProjectHierarchy`

### Pipeline push (orden)

1. Provision fields pendientes
2. Sync drafts/issues, sub-issues, field values por fila
3. `pullProject` + **`mergeTasksAfterPush`** (no vaciar `generalTasks`)
4. Escribir JSON `dirty: false` si OK

## API local

| Método | Ruta | Notas |
|--------|------|--------|
| GET/PUT | `/api/projects/:id` | Lee/guarda JSON; PUT coalesce ~40ms desde UI |
| POST | `/api/projects/:id/pull` | `force: true` sobrescribe local |
| POST | `/api/projects/:id/push` | Rechaza DEMO ids; 401 sin token |

## Convenciones al cambiar código

1. **Minimizar alcance** — no mezclar refactors con fixes de sync.
2. **Tarea general** — canónicos en props; custom en `githubFieldValues`; push vía `projectItemFromGeneralTask` en `graphql.ts`.
3. **Post-push** — siempre enriquecer con `mergeTasksAfterPush`, no reemplazar `generalTasks` solo desde subtareas.
4. **Panel editar** — canónicos arriba; «Campos del proyecto» = `githubEditPanelCustomColumns` (sin duplicar canónicos).
5. **Tests** — añadir casos en `lib/github/*.test.ts`; E2E live solo con `GH_TOKEN` (ver script cuando exista).

## Documentación relacionada (repo)

- [`README.md`](../README.md) — arranque rápido
- [`project-fields-schema.md`](./project-fields-schema.md)
- [`project-tasks-schema.md`](./project-tasks-schema.md)
- [`e2e-github-sync-evidence.md`](./e2e-github-sync-evidence.md) — evidencias E2E

Contrato de fields ampliado (store PM): documento `contrato-fields-rakkau-ops.md` en el Agent Store del proyecto CIAM.

## Cursor / agentes

Reglas persistentes: [`.cursor/rules/rakkau-ops-platform.mdc`](../.cursor/rules/rakkau-ops-platform.mdc). Leer este `CONTEXT.md` antes de tocar sync GitHub o jerarquía.
