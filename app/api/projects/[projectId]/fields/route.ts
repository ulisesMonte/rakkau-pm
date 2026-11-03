import { NextResponse } from "next/server";
import { readProject, writeProject } from "@/lib/fs/store";
import {
  createField,
  GitHubGraphQLError,
  hasToken,
  pullProject,
  type CreateFieldInput,
} from "@/lib/github/graphql";
import { CANONICAL_FIELDS, type FieldOption, type ProjectField } from "@/lib/types";
import { isViewOnly, viewerReadonlyPayload } from "@/lib/viewOnly";

type Ctx = { params: Promise<{ projectId: string }> };

const ALLOWED_TYPES = new Set<CreateFieldInput["dataType"]>([
  "TEXT",
  "NUMBER",
  "DATE",
  "SINGLE_SELECT",
]);

function isDemoProjectId(projectId: string): boolean {
  return projectId.startsWith("PVT_kwDODEMO") || projectId.includes("DEMO");
}

type Body = {
  name?: string;
  dataType?: string;
  options?: FieldOption[];
};

export async function POST(request: Request, ctx: Ctx) {
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

  const body = (await request.json()) as Body;
  const name = String(body.name ?? "").trim();
  const dataType = body.dataType as CreateFieldInput["dataType"];

  if (!name) {
    return NextResponse.json({ error: "Falta el nombre del campo" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(dataType)) {
    return NextResponse.json(
      { error: "Tipo no permitido. Usá TEXT, NUMBER, DATE o SINGLE_SELECT." },
      { status: 400 },
    );
  }
  if (Object.values(CANONICAL_FIELDS).includes(name as (typeof CANONICAL_FIELDS)[keyof typeof CANONICAL_FIELDS])) {
    return NextResponse.json(
      { error: `"${name}" es un campo estándar; elegí otro nombre.` },
      { status: 400 },
    );
  }
  if (existing.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json(
      { error: `Ya existe el campo "${name}" en este proyecto.` },
      { status: 409 },
    );
  }
  if (dataType === "SINGLE_SELECT" && !(body.options?.length)) {
    return NextResponse.json(
      { error: "SINGLE_SELECT requiere al menos una opción." },
      { status: 400 },
    );
  }

  let field: ProjectField;
  let createdOnGitHub = false;

  const canMutateRemote =
    hasToken() && !isDemoProjectId(decoded);

  if (canMutateRemote) {
    try {
      const created = await createField({
        projectId: decoded,
        name,
        dataType,
        singleSelectOptions:
          dataType === "SINGLE_SELECT"
            ? (body.options ?? []).map((o) => ({
                name: o.name,
                color: o.color ?? "GRAY",
                description: o.description ?? "",
              }))
            : undefined,
      });
      field = { ...created, pendingCreate: false };
      createdOnGitHub = true;
    } catch (e) {
      const message =
        e instanceof GitHubGraphQLError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No se pudo crear el campo en GitHub";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } else {
    field = {
      id: `pending_${name.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`,
      name,
      dataType,
      options: dataType === "SINGLE_SELECT" ? body.options : undefined,
      pendingCreate: true,
    };
  }

  let project = {
    ...existing,
    fields: [...existing.fields, field],
    dirty: true,
  };

  if (createdOnGitHub) {
    try {
      const pulled = await pullProject(decoded);
      project = {
        ...project,
        fields: pulled.fields,
      };
    } catch {
      /* keep local fields merge */
    }
  }

  await writeProject(project);

  return NextResponse.json({
    ok: true,
    createdOnGitHub,
    offline: !canMutateRemote,
    project,
  });
}
