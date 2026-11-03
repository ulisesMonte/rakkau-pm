# rakkau ops — GitHub Projects (PoC)

Planilla operativa Rakkau sobre **GitHub Projects v2** (sin DB): JSON local, jerarquía **tarea general → subtarea**, dependencias, sprints/Quarter. Branch `frontend` arranca en **visor solo lectura** (`NEXT_PUBLIC_VIEW_ONLY=true`): Traer + ojo, sin Publicar ni ediciones.

## Arranque

```bash
cd rakkau-pm
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# Editá .env.local → GH_TOKEN=…  (visor: read:project; edición: project)
# NEXT_PUBLIC_VIEW_ONLY=true por defecto en esta branch
# GH_ISSUE_REPOSITORY=owner/repo es solo fallback
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Sin token la UI corre offline con el fixture.

**Contexto para dev y agentes:** [`docs/CONTEXT.md`](docs/CONTEXT.md) · pruebas E2E: [`docs/e2e-github-sync-evidence.md`](docs/e2e-github-sync-evidence.md)

El PAT se lee de **`.env.local`** (o `.env`) vía `process.env.GH_TOKEN`. Nunca lo pongas en el JSON ni en el client. Después de cambiar el `.env*`, reiniciá `npm run dev`. En edición, el **repo de issues** se elige por Project en la UI; en viewer se muestra solo como dato.

## Qué ver en la UI

- Logo oficial `public/rakkau-logo.png` en el header · tipografía **Nunito**.
- Tema **dark amigable** (slate tipo GitHub + cyan/magenta Rakkau).
- **Viewer**: Tareas · Sprints · Calendario (sin Objetivos Q); botón Traer; solo ojo.
- **Edición** (`VIEW_ONLY=false`): Objetivos Q · Publicar / Traer · lápiz / agregar.
- **Tarea general** vs **Subtarea**, con **fecha de vencimiento** (`DueDate`), Responsable, EstadoOperativo, % avance.
- **Sprints** / **Calendario**: vencimientos y franjas de Q.

## Fields canónicos

| Columna UI | Field GitHub | Tipo |
|---|---|---|
| Tarea general | `Task` | MULTI_SELECT |
| ¿Tiene dependencia? | `HasDependency` | SINGLE_SELECT (`Sí` / `No`) |
| Depende de | `DependsOn` | TEXT (lista coma-separada) |
| Sprint | `Sprint` | TEXT |
| Quarter | `Quarter` | SINGLE_SELECT / TEXT |
| Vence | `DueDate` | DATE |
| Responsable | `Responsable` | SINGLE_SELECT (`rakkau` / `cliente`) — tarea general |
| Estado | `EstadoOperativo` | SINGLE_SELECT (`a tiempo` / `impactado` / `pausado`) — tarea general |
| Avance | — | % subtareas cerradas (UI, derivado) |
| Motivo (si Status = Bloqueado) | `BlockedReason` | TEXT — el Sí/No Blocked no se muestra en UI |

El PAT vive solo en `GH_TOKEN` (nunca en JSON). El fixture `PVT_kwDODEMO_*` no hace push real.

## API local

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/projects?remote=1` | Índice local (+ remoto si hay token) |
| GET/PUT | `/api/projects/:id` | Lee / guarda JSON (incluye `sprints`) |
| POST | `.../pull` | Traer de GitHub (`force` si hay cambios locales) |
| POST | `.../push` | Publicar fields a GitHub |

Contrato: `docs/contrato-fields-rakkau-ops.md` en el store del Project.
