/**
 * GitHub Issue Relationships: blockedBy / blocking (not Project fields, not `-D`).
 */

export type RelationRef = {
  id: string;
  number?: number | null;
  title?: string | null;
  url?: string | null;
};

/** True when the issue has at least one GitHub `blockedBy` relationship. */
export function isBlockedByRelations(
  blockedBy: string[] | undefined | null,
): boolean {
  return (blockedBy?.length ?? 0) > 0;
}

/** True when the issue blocks at least one other issue. */
export function isBlockingRelations(
  blocks: string[] | undefined | null,
): boolean {
  return (blocks?.length ?? 0) > 0;
}

/**
 * Display labels for related issue node IDs using a lookup of board items.
 * Falls back to a short id slice when the related issue is off-board.
 */
export function formatRelationLabels(
  ids: string[] | undefined | null,
  lookup: Map<string, { number?: number | null; title?: string | null }>,
): string[] {
  if (!ids?.length) return [];
  return ids.map((id) => {
    const hit = lookup.get(id);
    if (hit?.number != null) {
      const t = hit.title?.trim();
      return t ? `#${hit.number} ${t}` : `#${hit.number}`;
    }
    return id.length > 12 ? `${id.slice(0, 10)}…` : id;
  });
}

/** Build contentId → item map for relation label resolution. */
export function contentIdLookup(
  items: Array<{
    contentNodeId?: string | null;
    number?: number | null;
    title?: string | null;
  }>,
  generalTasks?: Array<{
    githubContentNodeId?: string | null;
    issueNumber?: number | null;
    title?: string | null;
  }>,
): Map<string, { number?: number | null; title?: string | null }> {
  const map = new Map<string, { number?: number | null; title?: string | null }>();
  for (const it of items) {
    if (!it.contentNodeId) continue;
    map.set(it.contentNodeId, { number: it.number, title: it.title });
  }
  for (const gt of generalTasks ?? []) {
    if (!gt.githubContentNodeId) continue;
    if (map.has(gt.githubContentNodeId)) continue;
    map.set(gt.githubContentNodeId, {
      number: gt.issueNumber,
      title: gt.title,
    });
  }
  return map;
}
