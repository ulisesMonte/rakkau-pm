import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import { ensureCanonicalFields } from "@/lib/github/graphql";
import type { ProjectDocument } from "@/lib/types";
import { isViewOnly, viewerReadonlyPayload } from "@/lib/viewOnly";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { projectId } = await ctx.params;
  const decoded = decodeURIComponent(projectId);
  const doc = await readProject(decoded);
  if (!doc) {
    return NextResponse.json(
      { error: `Proyecto ${decoded} no encontrado en filesystem` },
      { status: 404 },
    );
  }
  return NextResponse.json(doc);
}

export async function PUT(request: Request, ctx: Ctx) {
  if (isViewOnly()) {
    return NextResponse.json(viewerReadonlyPayload(), { status: 405 });
  }

  const { projectId } = await ctx.params;
  const decoded = decodeURIComponent(projectId);
  const body = (await request.json()) as ProjectDocument;

  if (!body?.projectId) {
    return NextResponse.json(
      { error: "Body inválido: falta projectId" },
      { status: 400 },
    );
  }
  if (body.projectId !== decoded) {
    return NextResponse.json(
      { error: "projectId de URL no coincide con el body" },
      { status: 400 },
    );
  }

  const withFields = ensureCanonicalFields({
    ...body,
    dirty: body.dirty !== false,
  });
  const path = await writeProject(withFields);
  return NextResponse.json({ ok: true, path, project: withFields });
}
