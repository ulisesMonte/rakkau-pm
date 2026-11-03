# rakkau ops — GitHub Projects (PoC)

Planilla operativa Rakkau sobre **GitHub Projects v2** (sin DB): JSON local, jerarquía **tarea general → subtarea**, dependencias, sprints/Quarter, y botones **Publicar / Traer de GitHub**.

## Arranque

```bash
cd rakkau-pm
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# Editá .env.local → GH_TOKEN=ghp_xxx  (Classic PAT scope project)
# GH_ISSUE_REPOSITORY=owner/repo es solo fallback; en la UI elegís «Repo de issues»
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Sin token la UI corre offline con el fixture.

**Contexto para dev y agentes:** [`docs/CONTEXT.md`](docs/CONTEXT.md) · pruebas E2E: [`docs/e2e-github-sync-evidence.md`](docs/e2e-github-sync-evidence.md)

El PAT se lee de **`.env.local`** (o `.env`) vía `process.env.GH_TOKEN`. Nunca lo pongas en el JSON ni en el client. Después de cambiar el `.env*`, reiniciá `npm run dev`. El **repo de issues** se elige por Project en la UI (persistido en JSON); `GH_ISSUE_REPOSITORY` queda como fallback.

## Qué ver en la UI

- Logo oficial `public/rakkau-logo.png` en el header.
- Tema **dark amigable** (slate tipo GitHub + cyan/magenta Rakkau).
- Pestañas: **Tareas** · **Sprints** · **Calendario**.
- **Tarea general** vs **Subtarea**, con **fecha de vencimiento** (`DueDate`).
- **¿Tiene dependencia?** + selector **Depende de**.
- **Sprints**: crear por fechas, progreso del Q.
- **Calendario**: vencimientos por día + franjas de sprint y Quarter.

## Fields canónicos

| Columna UI | Field GitHub | Tipo |
|---|---|---|
| Tarea general | `Task` | MULTI_SELECT |
| ¿Tiene dependencia? | `HasDependency` | SINGLE_SELECT (`Sí` / `No`) |
| Depende de | `DependsOn` | TEXT (lista coma-separada) |
| Sprint | `Sprint` | TEXT |
| Quarter | `Quarter` | SINGLE_SELECT / TEXT |
| Vence | `DueDate` | DATE |
| Bloqueada | `Blocked` | SINGLE_SELECT |
| Motivo | `BlockedReason` | TEXT |

El PAT vive solo en `GH_TOKEN` (nunca en JSON). El fixture `PVT_kwDODEMO_*` no hace push real.

## API local

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/projects?remote=1` | Índice local (+ remoto si hay token) |
| GET/PUT | `/api/projects/:id` | Lee / guarda JSON (incluye `sprints`) |
| POST | `.../pull` | Traer de GitHub (`force` si hay cambios locales) |
| POST | `.../push` | Publicar fields a GitHub |

Contrato: `docs/contrato-fields-rakkau-ops.md` en el store del Project.
