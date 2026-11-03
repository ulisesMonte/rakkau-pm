import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import {
  deleteProjectV2Item,
  GitHubGraphQLError,
  hasToken,
} from "@/lib/github/graphql";
import { isViewOnly, viewerReadonlyPayload } from "@/lib/viewOnly";

type Ctx = { params: Promise<{ projectId: string; itemId: string }> };

function isDemoProjectId(projectId: string): boolean {
  return projectId.startsWith("PVT_kwDODEMO") || projectId.includes("DEMO");
}

export async function DELETE(_request: Request, ctx: Ctx) {
  if (isViewOnly()) {
    return NextResponse.json(viewerReadonlyPayload(), { status: 405 });
  }

  const { projectId, itemId } = await ctx.params;
  const decodedProject = decodeURIComponent(projectId);
  const decodedItem = decodeURIComponent(itemId);

  const existing = await readProject(decodedProject);
  if (!existing) {
    return NextResponse.json(
      { error: `Proyecto ${decodedProject} no encontrado` },
      { status: 404 },
    );
  }

  const item = existing.items.find((i) => i.nodeId === decodedItem);
  if (!item) {
    return NextResponse.json(
      { error: "Ítem no encontrado en el JSON local" },
      { status: 404 },
    );
  }

  const isLocalOnly =
    item.nodeId.startsWith("local_item_") || item.nodeId.startsWith("local_");

  if (hasToken() && !isDemoProjectId(decodedProject) && !isLocalOnly) {
    try {
      await deleteProjectV2Item(decodedProject, item.nodeId);
    } catch (e) {
      const message =
        e instanceof GitHubGraphQLError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No se pudo eliminar en GitHub";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const project = {
    ...existing,
    items: existing.items.filter((i) => i.nodeId !== decodedItem),
    dirty: existing.dirty,
  };

  await writeProject(project);

  return NextResponse.json({
    ok: true,
    removedFromGitHub: hasToken() && !isDemoProjectId(decodedProject) && !isLocalOnly,
    project,
  });
}
