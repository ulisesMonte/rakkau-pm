import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import {
  GitHubGraphQLError,
  hasToken,
  publishSprintToGitHub,
} from "@/lib/github/graphql";

type Ctx = { params: Promise<{ projectId: string; sprintId: string }> };

/**
 * POST — Publicar sprint → milestones de GitHub + asignar issues.
 * Explicit mutation: NOT gated by VIEW_ONLY (Traer stays read-only; this is opt-in).
 */
export async function POST(_request: Request, ctx: Ctx) {
  const { projectId, sprintId } = await ctx.params;
  const decoded = decodeURIComponent(projectId);
  const sid = decodeURIComponent(sprintId);

  const existing = await readProject(decoded);
  if (!existing) {
    return NextResponse.json(
      { error: `Proyecto ${decoded} no encontrado` },
      { status: 404 },
    );
  }

  if (!hasToken()) {
    return NextResponse.json(
      {
        ok: false,
        offline: true,
        message:
          "Sin GH_TOKEN — no se crean milestones. Seteá GH_TOKEN con scope repo.",
        project: existing,
      },
      { status: 401 },
    );
  }

  if (decoded.startsWith("PVT_kwDODEMO") || decoded.includes("DEMO")) {
    return NextResponse.json(
      {
        ok: false,
        offline: true,
        message: "Fixture demo: no se publican milestones a GitHub.",
        project: existing,
      },
      { status: 400 },
    );
  }

  try {
    const { document, result } = await publishSprintToGitHub(existing, sid);
    await writeProject(document);
    return NextResponse.json({
      ok: true,
      offline: false,
      project: document,
      milestones: result.milestones,
      assignedIssueIds: result.assignedIssueIds,
      clearedIssueIds: result.clearedIssueIds,
      warnings: result.warnings,
      partial: result.warnings.length > 0,
    });
  } catch (e) {
    const message =
      e instanceof GitHubGraphQLError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Publish sprint falló";
    const status = e instanceof GitHubGraphQLError && e.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: message, project: existing },
      { status },
    );
  }
}
