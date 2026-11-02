import { NextResponse } from "next/server";
import { listLocalProjects, readIndex, writeIndex } from "@/lib/fs/store";
import { hasToken, listProjects, GitHubGraphQLError } from "@/lib/github/graphql";
import type { ProjectsIndex } from "@/lib/types";

/** GET — local index + optional remote list when GH_TOKEN is set */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const remote = searchParams.get("remote") === "1";

  const local = await listLocalProjects();
  const index = await readIndex();

  let remoteProjects = null;
  let remoteError: string | null = null;

  if (remote) {
    if (!hasToken()) {
      remoteError = "GH_TOKEN no configurado — listando solo fixture local.";
    } else {
      try {
        remoteProjects = await listProjects();
      } catch (e) {
        remoteError =
          e instanceof GitHubGraphQLError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Error al listar Projects";
      }
    }
  }

  return NextResponse.json({
    index,
    local,
    remote: remoteProjects,
    remoteError,
    hasToken: hasToken(),
  });
}

/** POST — replace or merge index.json */
export async function POST(request: Request) {
  const body = (await request.json()) as ProjectsIndex;
  if (!body || !Array.isArray(body.projects)) {
    return NextResponse.json(
      { error: "Body inválido: se espera { projects: [] }" },
      { status: 400 },
    );
  }
  await writeIndex(body);
  const index = await readIndex();
  return NextResponse.json({ index });
}
