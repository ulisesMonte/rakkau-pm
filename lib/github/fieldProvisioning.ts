import type { ProjectField } from "@/lib/types";
import {
  CANONICAL_FIELD_DEFINITIONS,
  canonicalFieldsCreateSpecs,
  findFieldByCanonical,
} from "@/lib/github/projectFieldsSchema";

export type FieldProvisionResult = {
  created: string[];
  skipped: string[];
  errors: string[];
};

export type CreateProjectFieldFn = (spec: {
  name: string;
  dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT";
  singleSelectOptions?: Array<{
    name: string;
    color: string;
    description: string;
  }>;
}) => Promise<void>;

type MissingFieldSpec = {
  name: string;
  dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT";
  singleSelectOptions?: Array<{
    name: string;
    color: string;
    description: string;
  }>;
  reason: "canonical" | "local_pending";
};

/** Columnas que la UI/Rakkau espera: canónicas + custom con pendingCreate. */
export function fieldsMissingOnGitHub(fields: ProjectField[]): MissingFieldSpec[] {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  const out: MissingFieldSpec[] = [];

  for (const spec of CANONICAL_FIELD_DEFINITIONS) {
    const hit = findFieldByCanonical(fields, spec.key);
    if (!hit || hit.pendingCreate) {
      out.push({
        name: spec.githubFieldName,
        dataType: spec.dataType,
        singleSelectOptions: spec.singleSelectOptions?.map((o) => ({
          name: o.name,
          color: o.color ?? "GRAY",
          description: o.description ?? "",
        })),
        reason: "canonical",
      });
    }
  }

  for (const f of fields) {
    if (!f.pendingCreate) continue;
    if (byName.get(f.name.toLowerCase()) !== f) continue;
    if (CANONICAL_FIELD_DEFINITIONS.some((d) => d.githubFieldName === f.name)) {
      continue;
    }
    if (
      f.dataType === "TEXT" ||
      f.dataType === "NUMBER" ||
      f.dataType === "DATE" ||
      f.dataType === "SINGLE_SELECT"
    ) {
      out.push({
        name: f.name,
        dataType: f.dataType,
        singleSelectOptions: f.options?.map((o) => ({
          name: o.name,
          color: o.color ?? "GRAY",
          description: o.description ?? "",
        })),
        reason: "local_pending",
      });
    }
  }

  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function ensureAllUiFieldsOnGitHub(
  fields: ProjectField[],
  createField: CreateProjectFieldFn,
): Promise<FieldProvisionResult> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const missing = fieldsMissingOnGitHub(fields);
  for (const spec of missing) {
    try {
      await createField({
        name: spec.name,
        dataType: spec.dataType,
        singleSelectOptions: spec.singleSelectOptions,
      });
      created.push(spec.name);
    } catch {
      errors.push(spec.name);
    }
  }

  for (const spec of canonicalFieldsCreateSpecs()) {
    if (created.includes(spec.name)) continue;
    const hit = fields.find(
      (f) => f.name.toLowerCase() === spec.name.toLowerCase() && !f.pendingCreate,
    );
    if (hit) skipped.push(spec.name);
  }

  return { created, skipped, errors };
}
