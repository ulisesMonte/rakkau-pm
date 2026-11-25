/**
 * Parse Jira ticket IDs from issue description / body.
 * Tolerant of Excel/Sheet CIAM formats: `PROJ-123`, `ID JIRA: …`, links, etc.
 */

/** Classic Jira key: PROJECTKEY-123 (2–10 letter prefix). */
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

const LABELED_LINE_RE =
  /(?:^|\n)\s*(?:id\s*jira|jira\s*id|jira|ticket\s*jira)\s*[:#=-]?\s*([A-Z][A-Z0-9]{1,9}-\d+)/i;

const URL_KEY_RE =
  /(?:atlassian\.net|jira\.[^\s/]+)\/(?:browse|issues)\/([A-Z][A-Z0-9]{1,9}-\d+)/i;

/** Keys that look like Jira but are usually GitHub/CI noise — skip. */
const SKIP_PREFIXES = new Set([
  "CVE",
  "GHSA",
  "RFC",
  "ISO",
  "UTF",
  "HTTP",
  "HTTPS",
]);

function isPlausibleKey(key: string): boolean {
  const prefix = key.split("-")[0]?.toUpperCase() ?? "";
  if (SKIP_PREFIXES.has(prefix)) return false;
  // Avoid matching bare dates like 2026-11
  if (/^\d{4}-\d+$/.test(key)) return false;
  return true;
}

/**
 * Extract the primary Jira key from free text (description/body).
 * Prefers an explicit "ID JIRA:" line, then browse URLs, then first plausible key.
 */
export function parseJiraKeyFromText(
  text: string | null | undefined,
): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const labeled = raw.match(LABELED_LINE_RE);
  if (labeled?.[1] && isPlausibleKey(labeled[1].toUpperCase())) {
    return labeled[1].toUpperCase();
  }

  const fromUrl = raw.match(URL_KEY_RE);
  if (fromUrl?.[1] && isPlausibleKey(fromUrl[1].toUpperCase())) {
    return fromUrl[1].toUpperCase();
  }

  JIRA_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JIRA_KEY_RE.exec(raw)) !== null) {
    const key = m[1].toUpperCase();
    if (isPlausibleKey(key)) return key;
  }
  return null;
}

/** All distinct Jira keys found in text (uppercase). */
export function parseAllJiraKeysFromText(
  text: string | null | undefined,
): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const primary = parseJiraKeyFromText(raw);
  if (primary) {
    seen.add(primary);
    out.push(primary);
  }
  JIRA_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JIRA_KEY_RE.exec(raw)) !== null) {
    const key = m[1].toUpperCase();
    if (!isPlausibleKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Build browse URL when `JIRA_BASE_URL` (or override) is set. */
export function jiraBrowseUrl(
  key: string | null | undefined,
  baseUrl?: string | null,
): string | null {
  const k = (key ?? "").trim().toUpperCase();
  if (!k) return null;
  const base = (baseUrl ?? process.env.JIRA_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/browse/${k}`;
}

/** Client-safe URL builder (pass base from env exposed via NEXT_PUBLIC_ or props). */
export function jiraBrowseUrlWithBase(
  key: string | null | undefined,
  baseUrl: string | null | undefined,
): string | null {
  const k = (key ?? "").trim().toUpperCase();
  if (!k) return null;
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/browse/${k}`;
}
