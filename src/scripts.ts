import type { DatabaseSync } from "node:sqlite";
import { isDeadlineValid } from "./deadline.ts";

type Action = "request_changes" | "approve" | "submit_version";

type VersionBase = { number: number; content: string; submitted_at: string; late: boolean };

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

const ROLE: Record<Action, Actor["role"]> = {
  request_changes: "brand",
  approve: "brand",
  submit_version: "creator",
};

export type Actor = { role: "brand" | "creator"; id: string };

export type ScriptView = {
  id: string;
  title: string;
  campaign_id: string;
  brand_id: string;
  creator_id: string;
  timezone: string;
  status: Version["status"];
  waiting_on: Actor["role"] | null;
  allowed_actions: Action[];
  current_version: number;
  versions: Version[];
};

export class ReviewError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422,
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
  late: number;
};

// Os CHECKs de db.ts garantem que os campos de cada status estão preenchidos.
function toVersion(row: VersionRow): Version {
  const base = { number: row.number, content: row.content, submitted_at: row.submitted_at, late: row.late === 1 };
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

export function resolveActor(db: DatabaseSync, header: string | undefined): Actor | undefined {
  const [role, id, ...resto] = (header ?? "").split(":");
  if (resto.length || !id || (role !== "brand" && role !== "creator")) return undefined;
  const table = role === "brand" ? "brands" : "creators";
  return db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) ? { role, id } : undefined;
}

type ScriptRow = {
  id: string;
  title: string;
  campaign_id: string;
  creator_id: string;
  brand_id: string;
  timezone: string;
};

const SCRIPT_SELECT = `SELECT s.id, s.title, s.campaign_id, s.creator_id, c.brand_id, b.timezone
  FROM scripts s JOIN campaigns c ON c.id = s.campaign_id JOIN brands b ON b.id = c.brand_id`;

// A marca vê os roteiros das suas campanhas; o criador, os que ele criou.
function ownerColumn(actor: Actor): string {
  return actor.role === "brand" ? "c.brand_id" : "s.creator_id";
}

function toView(db: DatabaseSync, row: ScriptRow, actor: Actor): ScriptView {
  const rows = db
    .prepare("SELECT * FROM versions WHERE script_id = ? ORDER BY number")
    .all(row.id) as unknown as VersionRow[];
  const versions = rows.map(toVersion);
  const latest = versions[versions.length - 1]!;
  const next = ALLOWED[latest.status];
  return {
    id: row.id,
    title: row.title,
    campaign_id: row.campaign_id,
    brand_id: row.brand_id,
    creator_id: row.creator_id,
    timezone: row.timezone,
    status: latest.status,
    waiting_on: next.length ? ROLE[next[0]!] : null,
    allowed_actions: next.filter((a) => ROLE[a] === actor.role),
    current_version: latest.number,
    versions,
  };
}

export function getScript(db: DatabaseSync, id: string, actor: Actor): ScriptView {
  const row = db
    .prepare(`${SCRIPT_SELECT} WHERE s.id = ? AND ${ownerColumn(actor)} = ?`)
    .get(id, actor.id) as ScriptRow | undefined;
  if (!row) throw new ReviewError(404, "script_not_found", "Roteiro não encontrado.");
  return toView(db, row, actor);
}

export function listScripts(db: DatabaseSync, actor: Actor, status?: string, campaignId?: string) {
  const rows = db
    .prepare(
      `${SCRIPT_SELECT} WHERE ${ownerColumn(actor)} = ? AND (? IS NULL OR s.campaign_id = ?) ORDER BY s.created_at, s.id`,
    )
    .all(actor.id, campaignId ?? null, campaignId ?? null) as unknown as ScriptRow[];
  return rows
    .map((row) => toView(db, row, actor))
    .filter((view) => !status || view.status === status)
    .map(({ versions: _versions, ...view }) => view);
}

export const STATUSES = Object.keys(ALLOWED);

// Síncrona de propósito: sem await entre a checagem do estado e a escrita, uma ação
// concorrente não sobrescreve outra (por exemplo, um pedido de alteração sobre uma aprovação).
function transition(
  db: DatabaseSync,
  id: string,
  actor: Actor,
  action: Action,
  write: (view: ScriptView) => void,
): ScriptView {
  const view = getScript(db, id, actor);
  if (ROLE[action] !== actor.role) {
    throw new ReviewError(403, "forbidden", `Um perfil "${actor.role}" não pode executar a ação "${action}".`);
  }
  if (!ALLOWED[view.status].includes(action)) {
    throw new ReviewError(
      409,
      "invalid_transition",
      `A ação "${action}" não é permitida com o roteiro em "${view.status}".`,
    );
  }
  write(view);
  return getScript(db, id, actor);
}

export function createScript(
  db: DatabaseSync,
  actor: Actor,
  campaignId: string,
  title: string,
  content: string,
  now: Date,
): ScriptView {
  if (actor.role !== "creator") throw new ReviewError(403, "forbidden", "Só um criador pode criar roteiros.");
  if (!db.prepare("SELECT 1 FROM campaigns WHERE id = ?").get(campaignId)) {
    throw new ReviewError(404, "campaign_not_found", "Campanha não encontrada.");
  }
  const id = `scr_${crypto.randomUUID()}`;
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO scripts (id, campaign_id, creator_id, title, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, campaignId, actor.id, title, now.toISOString());
    db.prepare(
      "INSERT INTO versions (script_id, number, content, submitted_at, status) VALUES (?, 1, ?, ?, 'in_review')",
    ).run(id, content, now.toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getScript(db, id, actor);
}

export function requestChanges(db: DatabaseSync, id: string, actor: Actor, reason: string, dueDate: string, now: Date) {
  return transition(db, id, actor, "request_changes", (view) => {
    if (!isDeadlineValid(dueDate, now, view.timezone)) throw new ReviewError(422, "due_date_passed", "O prazo já passou.");
    db.prepare(
      `UPDATE versions SET status = 'changes_requested', change_reason = ?, change_due_date = ?, changes_requested_at = ?
       WHERE script_id = ? AND number = ?`,
    ).run(reason, dueDate, now.toISOString(), view.id, view.current_version);
  });
}

export function submitVersion(db: DatabaseSync, id: string, actor: Actor, content: string, now: Date) {
  return transition(db, id, actor, "submit_version", (view) => {
    const previous = view.versions[view.versions.length - 1]!;
    const late =
      previous.status === "changes_requested" &&
      !isDeadlineValid(previous.change_request.due_date, now, view.timezone);
    db.prepare(
      "INSERT INTO versions (script_id, number, content, submitted_at, status, late) VALUES (?, ?, ?, ?, 'in_review', ?)",
    ).run(view.id, view.current_version + 1, content, now.toISOString(), late ? 1 : 0);
  });
}

export function approve(db: DatabaseSync, id: string, actor: Actor, now: Date) {
  return transition(db, id, actor, "approve", (view) => {
    db.prepare("UPDATE versions SET status = 'approved', approved_at = ? WHERE script_id = ? AND number = ?").run(
      now.toISOString(),
      view.id,
      view.current_version,
    );
  });
}
