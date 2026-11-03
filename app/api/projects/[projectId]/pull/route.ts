import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import {
  ensureCanonicalFields,
  GitHubGraphQLError,
  hasToken,
  provisionCanonicalFields,
  pullProject,
} from "@/lib/github/graphql";
import {
  pickDefaultIssueRepository,
  uniqueRepositorySlugs,
} from "@/lib/github/issueHierarchy";
import { PROJECT_FIELDS_SCHEMA_VERSION } from "@/lib/github/projectFieldsSchema";
import { PROJECT_TASKS_SCHEMA_VERSION } from "@/lib/github/projectTasksSchema";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * POST — Traer de GitHub.
 * Si no hay token o falla la API, conserva / devuelve el fixture local.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { projectId } = await ctx.params;
  const decoded = decodeURIComponent(projectId);

  let force = false;
  try {
    const body = await request.json();
    force = Boolean(body?.force);
  } catch {
    /* empty body ok */
  }

  const existing = await readProject(decoded);
  if (existing?.dirty && !force) {
    return NextResponse.json(
      {
        error:
          "Hay cambios locales sin pushear (dirty). Confirmá con force=true o pusheá primero.",
        dirty: true,
        project: existing,
      },
      { status: 409 },
    );
  }

  if (!hasToken()) {
    if (existing) {
      return NextResponse.json({
        ok: true,
        offline: true,
        message:
          "Sin GH_TOKEN — se mantiene el JSON local (fixture). Seteá GH_TOKEN para pull real.",
        project: existing,
      });
    }
    return NextResponse.json(
      {
        error:
          "Sin GH_TOKEN y sin JSON local. Usá el proyecto demo o configurá el token.",
      },
      { status: 401 },
    );
  }

  try {
    // 1. First pull to discover what fields already exist.
    let pulled = await pullProject(decoded);

    // 2. Auto-create any missing canonical fields on the GitHub project.
    const provision = await provisionCanonicalFields(pulled.projectId, pulled.fields);

    // 3. Re-pull only if we created new fields (so the doc has their real IDs).
    if (provision.created.length > 0) {
      pulled = await pullProject(decoded);
    }

    pulled = ensureCanonicalFields(pulled, { addPendingStubs: false });
    pulled.dirty = false;
    pulled.fieldsSchemaVersion = PROJECT_FIELDS_SCHEMA_VERSION;
    pulled.tasksSchemaVersion = PROJECT_TASKS_SCHEMA_VERSION;
    if (existing) {
      pulled.sprints = existing.sprints ?? pulled.sprints;
      pulled.links = existing.links ?? pulled.links;
      pulled.currentQuarter = existing.currentQuarter ?? pulled.currentQuarter;
      pulled.availableRepositories = uniqueRepositorySlugs(
        pulled.availableRepositories,
        existing.availableRepositories,
        existing.issueRepository,
      );
      pulled.issueRepository = pickDefaultIssueRepository({
        preferred: existing.issueRepository,
        available: pulled.availableRepositories,
        doc: pulled,
      });
    } else {
      pulled.issueRepository = pickDefaultIssueRepository({
        preferred: pulled.issueRepository,
        available: pulled.availableRepositories,
        doc: pulled,
      });
    }
    await writeProject(pulled);
    return NextResponse.json({
      ok: true,
      offline: false,
      project: pulled,
      provisioned: provision.created,
    });
  } catch (e) {
    const message =
      e instanceof GitHubGraphQLError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Pull falló";
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          offline: true,
          message: `API falló (${message}). Se conserva el JSON local.`,
          project: existing,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
