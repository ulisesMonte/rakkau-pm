import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import {
  ensureCanonicalFields,
  GitHubGraphQLError,
  hasToken,
  pushProject,
} from "@/lib/github/graphql";
import { isViewOnly, viewerReadonlyPayload } from "@/lib/viewOnly";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * POST — Actualizar GitHub.
 * Sin token: no muta remoto; marca mensaje y deja dirty.
 */
export async function POST(_request: Request, ctx: Ctx) {
  if (isViewOnly()) {
    return NextResponse.json(viewerReadonlyPayload(), { status: 405 });
  }

  const { projectId } = await ctx.params;
  const decoded = decodeURIComponent(projectId);
  const existing = await readProject(decoded);

  if (!existing) {
    return NextResponse.json(
      { error: `Proyecto ${decoded} no encontrado` },
      { status: 404 },
    );
  }

  const doc = ensureCanonicalFields(existing, {
    addPendingStubs: !hasToken(),
  });

  if (!hasToken()) {
    return NextResponse.json(
      {
        ok: false,
        offline: true,
        message:
          "Sin GH_TOKEN — no se muta GitHub. Los cambios quedan en JSON local (dirty).",
        project: doc,
      },
      { status: 401 },
    );
  }

  // Demo fixture IDs are not real — refuse mutating unless it looks like a real node id
  if (decoded.startsWith("PVT_kwDODEMO") || decoded.includes("DEMO")) {
    return NextResponse.json(
      {
        ok: false,
        offline: true,
        message:
          "Este es el fixture demo. No se hace push a GitHub. Traé un Project real con GH_TOKEN.",
        project: doc,
      },
      { status: 400 },
    );
  }

  try {
    const { document, warnings } = await pushProject(doc);
    await writeProject(document);
    return NextResponse.json({
      ok: true,
      offline: false,
      project: document,
      warnings,
      partial: warnings.length > 0,
    });
  } catch (e) {
    const message =
      e instanceof GitHubGraphQLError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Push falló";
    return NextResponse.json(
      { error: message, project: doc },
      { status: 502 },
    );
  }
}
