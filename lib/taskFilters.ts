import type { GeneralTask, ProjectItem } from "@/lib/types";
import { itemDisplayTitle } from "@/lib/itemTitle";
import { isActiveTaskStatus } from "@/lib/taskStatus";

export type TaskFilterQuery = {
  text: string[];
  is?: "open" | "closed";
  type?: "tarea" | "subtarea";
  assignee: string[];
  sprint: string[];
  quarter: string[];
  blocked?: "sí" | "no";
  depends?: "sí" | "no";
  padre: string[];
  dueSoon?: boolean;
};

const TOKEN_RE =
  /([^\s:"=]+):(?:"([^"]+)"|([^\s]+))|("([^"]+)"|([^\s]+))/g;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isBlockedField(
  blocked: string | undefined,
  status: string | undefined,
): boolean {
  if (blocked === "Sí") return true;
  return /^bloqueado$/i.test(String(status ?? "").trim());
}

function yesNo(raw: string): "sí" | "no" | undefined {
  const v = norm(raw);
  if (v === "si" || v === "sí" || v === "yes" || v === "true" || v === "1") {
    return "sí";
  }
  if (v === "no" || v === "false" || v === "0") return "no";
  return undefined;
}

/** Parse estilo GitHub: `is:open assignee:foo sprint:"Sprint 2" texto`. */
export function parseFilterQuery(input: string): TaskFilterQuery {
  const q: TaskFilterQuery = {
    text: [],
    assignee: [],
    sprint: [],
    quarter: [],
    padre: [],
  };
  if (!input.trim()) return q;

  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, "g");
  while ((m = re.exec(input)) !== null) {
    if (m[1]) {
      const key = norm(m[1]);
      const val = (m[2] ?? m[3] ?? "").trim();
      if (!val) continue;
      switch (key) {
        case "is":
        case "estado": {
          const v = norm(val);
          if (v === "open" || v === "abierta" || v === "abierto") q.is = "open";
          else if (v === "closed" || v === "cerrada" || v === "cerrado")
            q.is = "closed";
          break;
        }
        case "type":
        case "tipo": {
          const v = norm(val);
          if (v === "tarea" || v === "task" || v === "general") q.type = "tarea";
          else if (v === "subtarea" || v === "subtask" || v === "issue")
            q.type = "subtarea";
          break;
        }
        case "assignee":
        case "asignado":
        case "user":
          q.assignee.push(val.replace(/^@/, ""));
          break;
        case "sprint":
          q.sprint.push(val);
          break;
        case "q":
        case "quarter":
          q.quarter.push(val.toUpperCase());
          break;
        case "blocked":
        case "bloqueada":
        case "bloqueado": {
          const yn = yesNo(val);
          if (yn) q.blocked = yn;
          break;
        }
        case "depends":
        case "dependencia":
        case "dep": {
          const yn = yesNo(val);
          if (yn) q.depends = yn;
          break;
        }
        case "padre":
        case "task":
        case "parent":
          q.padre.push(val);
          break;
        case "due":
        case "vence":
          if (norm(val) === "soon" || norm(val) === "ya" || norm(val) === "1") {
            q.dueSoon = true;
          }
          break;
        default:
          q.text.push(`${m[1]}:${val}`);
      }
    } else {
      const word = (m[5] ?? m[6] ?? "").trim();
      if (word) q.text.push(word);
    }
  }
  return q;
}

export function serializeFilterQuery(q: TaskFilterQuery): string {
  const parts: string[] = [];
  if (q.is) parts.push(`is:${q.is}`);
  if (q.type) parts.push(`type:${q.type}`);
  for (const a of q.assignee) parts.push(`assignee:${a}`);
  for (const s of q.sprint) {
    parts.push(s.includes(" ") ? `sprint:"${s}"` : `sprint:${s}`);
  }
  for (const qq of q.quarter) parts.push(`q:${qq}`);
  if (q.blocked) parts.push(`blocked:${q.blocked}`);
  if (q.depends) parts.push(`depends:${q.depends}`);
  for (const p of q.padre) parts.push(`padre:${p}`);
  if (q.dueSoon) parts.push("due:soon");
  for (const t of q.text) {
    parts.push(t.includes(" ") ? `"${t}"` : t);
  }
  return parts.join(" ");
}

function isOpenState(state?: string): boolean {
  return isActiveTaskStatus(state);
}

function dueIsSoon(due?: string, state?: string): boolean {
  if (!due) return false;
  if (!isOpenState(state)) return false;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const d = new Date(`${due.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const diff = Math.round(
    (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  return diff === 0 || diff === 1;
}

function matchText(haystack: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const h = norm(haystack);
  return tokens.every((t) => h.includes(norm(t)));
}

export function generalTaskMatches(
  task: GeneralTask,
  q: TaskFilterQuery,
): boolean {
  if (q.type === "subtarea") return false;
  if (q.is === "open" && !isOpenState(task.Status)) return false;
  if (q.is === "closed" && isOpenState(task.Status)) return false;
  if (q.blocked === "sí" && !isBlockedField(task.Blocked, task.Status)) return false;
  if (q.blocked === "no" && isBlockedField(task.Blocked, task.Status)) return false;
  if (q.depends === "sí" && task.HasDependency !== "Sí") return false;
  if (q.depends === "no" && task.HasDependency === "Sí") return false;
  if (q.assignee.length) {
    const set = new Set((task.assignees ?? []).map(norm));
    if (!q.assignee.every((a) => set.has(norm(a)))) return false;
  }
  if (q.sprint.length) {
    const sp = norm(task.Sprint ?? "");
    if (!q.sprint.some((s) => sp === norm(s) || sp.includes(norm(s))))
      return false;
  }
  if (q.quarter.length) {
    const qq = norm(task.Quarter ?? "");
    if (!q.quarter.some((x) => qq === norm(x))) return false;
  }
  if (q.padre.length) {
    if (!q.padre.some((p) => norm(p) === norm(task.id))) return false;
  }
  if (q.dueSoon && !dueIsSoon(task.DueDate, task.Status)) return false;
  if (
    !matchText(`${task.id} ${task.title} ${task.description ?? ""}`, q.text)
  ) {
    return false;
  }
  return true;
}

export function subtaskMatches(
  item: ProjectItem,
  q: TaskFilterQuery,
): boolean {
  if (q.type === "tarea") return false;
  if (q.is === "open" && !isOpenState(item.state)) return false;
  if (q.is === "closed" && isOpenState(item.state)) return false;
  if (
    q.blocked === "sí" &&
    !isBlockedField(item.fieldValues.Blocked, item.fieldValues.Status)
  )
    return false;
  if (
    q.blocked === "no" &&
    isBlockedField(item.fieldValues.Blocked, item.fieldValues.Status)
  )
    return false;
  if (q.depends === "sí" && item.fieldValues.HasDependency !== "Sí")
    return false;
  if (q.depends === "no" && item.fieldValues.HasDependency === "Sí")
    return false;
  if (q.assignee.length) {
    const set = new Set((item.assignees ?? []).map(norm));
    if (!q.assignee.every((a) => set.has(norm(a)))) return false;
  }
  if (q.sprint.length) {
    const sp = norm(item.fieldValues.Sprint ?? "");
    if (!q.sprint.some((s) => sp === norm(s) || sp.includes(norm(s))))
      return false;
  }
  if (q.quarter.length) {
    const qq = norm(item.fieldValues.Quarter ?? "");
    if (!q.quarter.some((x) => qq === norm(x))) return false;
  }
  if (q.padre.length) {
    const parent = item.parentTaskId ?? "";
    if (!q.padre.some((p) => norm(p) === norm(parent))) return false;
  }
  if (q.dueSoon && !dueIsSoon(item.fieldValues.DueDate, item.state))
    return false;
  const label = `${item.number ?? ""} ${itemDisplayTitle(item)} ${item.parentTaskId ?? ""}`;
  if (!matchText(label, q.text)) return false;
  return true;
}

export function isQueryEmpty(q: TaskFilterQuery): boolean {
  return (
    !q.is &&
    !q.type &&
    !q.blocked &&
    !q.depends &&
    !q.dueSoon &&
    q.assignee.length === 0 &&
    q.sprint.length === 0 &&
    q.quarter.length === 0 &&
    q.padre.length === 0 &&
    q.text.length === 0
  );
}
