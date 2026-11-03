import { NextResponse } from "next/server";
import {
  GitHubGraphQLError,
  hasToken,
  lookupAccessibleProject,
} from "@/lib/github/graphql";

/**
 * POST — Resolver un Project accesible aunque no figure en el listado del viewer
 * (Project de otro user/org compartido). Body: `{ ref: string }`
 * (URL GitHub, `owner/number` o id `PVT_…`).
 */
export async function POST(request: Request) {
  if (!hasToken()) {
    return NextResponse.json(
      {
        error:
          "Sin GH_TOKEN. Configurá el token con scope `project` (y read:org si aplica) para abrir Projects compartidos.",
      },
      { status: 401 },
    );
  }

  let ref = "";
  try {
    const body = (await request.json()) as { ref?: unknown };
    ref = typeof body?.ref === "string" ? body.ref : "";
  } catch {
    return NextResponse.json(
      { error: "Body inválido: se espera { ref: string }" },
      { status: 400 },
    );
  }

  try {
    const project = await lookupAccessibleProject(ref);
    return NextResponse.json({ project });
  } catch (e) {
    const message =
      e instanceof GitHubGraphQLError
        ? e.message
        : e instanceof Error
          ? e.message
          : "No se pudo abrir el Project";
    const status = e instanceof GitHubGraphQLError ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
