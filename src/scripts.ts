import type { DatabaseSync } from "node:sqlite";
import { TIMEZONE, isDeadlineValid } from "./deadline.ts";

type Action = "request_changes" | "approve" | "submit_version";

type VersionBase = { number: number; content: string; submitted_at: string };

export type Version = VersionBase &
  (
    | { status: "in_review" }
    | { status: "changes_requested"; change_request: { reason: string; due_date: string; requested_at: string } }
    | { status: "approved"; approved_at: string }
  );

const ALLOWED: Record<Version["status"], Action[]> = {
  in_review: ["request_changes", "approve"],
  changes_requested: ["submit_version"],
  approved: [],
};

export type ScriptView = {
  id: string;
  title: string;
  timezone: string;
  status: Version["status"];
  allowed_actions: Action[];
  current_version: number;
  versions: Version[];
};

export class ReviewError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type VersionRow = {
  number: number;
  content: string;
  submitted_at: string;
  status: string;
  change_reason: string | null;
  change_due_date: string | null;
  changes_requested_at: string | null;
  approved_at: string | null;
};

// Os CHECKs de db.ts garantem que os campos de cada status estão preenchidos.
function toVersion(row: VersionRow): Version {
  const base = { number: row.number, content: row.content, submitted_at: row.submitted_at };
  if (row.status === "in_review") return { ...base, status: "in_review" };
  if (row.status === "approved") return { ...base, status: "approved", approved_at: row.approved_at! };
  return {
    ...base,
    status: "changes_requested",
    change_request: {
      reason: row.change_reason!,
      due_date: row.change_due_date!,
      requested_at: row.changes_requested_at!,
    },
  };
}

export function getScript(db: DatabaseSync, id: string): ScriptView {
  const script = db.prepare("SELECT id, title FROM scripts WHERE id = ?").get(id) as
    | { id: string; title: string }
    | undefined;
  if (!script) throw new ReviewError(404, "script_not_found", "Roteiro não encontrado.");
  const rows = db
    .prepare("SELECT * FROM versions WHERE script_id = ? ORDER BY number")
    .all(id) as unknown as VersionRow[];
  const versions = rows.map(toVersion);
  const latest = versions[versions.length - 1]!;
  return {
    id: script.id,
    title: script.title,
    timezone: TIMEZONE,
    status: latest.status,
    allowed_actions: ALLOWED[latest.status],
    current_version: latest.number,
    versions,
  };
}

// Síncrona de propósito: sem await entre a checagem do estado e a escrita, uma ação
// concorrente não sobrescreve outra (por exemplo, um pedido de alteração sobre uma aprovação).
function transition(db: DatabaseSync, id: string, action: Action, write: (view: ScriptView) => void): ScriptView {
  const view = getScript(db, id);
  if (!view.allowed_actions.includes(action)) {
    throw new ReviewError(
      409,
      "invalid_transition",
      `A ação "${action}" não é permitida com o roteiro em "${view.status}".`,
    );
  }
  write(view);
  return getScript(db, id);
}

export function createScript(db: DatabaseSync, title: string, content: string, now: Date): ScriptView {
  const id = `scr_${crypto.randomUUID()}`;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO scripts (id, title, created_at) VALUES (?, ?, ?)").run(id, title, now.toISOString());
    db.prepare(
      "INSERT INTO versions (script_id, number, content, submitted_at, status) VALUES (?, 1, ?, ?, 'in_review')",
    ).run(id, content, now.toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getScript(db, id);
}

export function requestChanges(db: DatabaseSync, id: string, reason: string, dueDate: string, now: Date) {
  return transition(db, id, "request_changes", (view) => {
    if (!isDeadlineValid(dueDate, now)) throw new ReviewError(422, "due_date_passed", "O prazo já passou.");
    db.prepare(
      `UPDATE versions SET status = 'changes_requested', change_reason = ?, change_due_date = ?, changes_requested_at = ?
       WHERE script_id = ? AND number = ?`,
    ).run(reason, dueDate, now.toISOString(), view.id, view.current_version);
  });
}

export function submitVersion(db: DatabaseSync, id: string, content: string, now: Date) {
  return transition(db, id, "submit_version", (view) => {
    db.prepare(
      "INSERT INTO versions (script_id, number, content, submitted_at, status) VALUES (?, ?, ?, ?, 'in_review')",
    ).run(view.id, view.current_version + 1, content, now.toISOString());
  });
}

export function approve(db: DatabaseSync, id: string, now: Date) {
  return transition(db, id, "approve", (view) => {
    db.prepare("UPDATE versions SET status = 'approved', approved_at = ? WHERE script_id = ? AND number = ?").run(
      now.toISOString(),
      view.id,
      view.current_version,
    );
  });
}
