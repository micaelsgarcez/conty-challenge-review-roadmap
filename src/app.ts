import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { isRealDate } from "./deadline.ts";
import * as scripts from "./scripts.ts";
import { ReviewError, STATUSES } from "./scripts.ts";
import type { Actor } from "./scripts.ts";

type Clock = { now?: () => Date };
type Body = Record<string, unknown>;

async function readBody(c: Context): Promise<Body> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ReviewError(422, "invalid_body", "O corpo deve ser um objeto JSON válido.");
  }
  return body as Body;
}

function text(body: Body, field: string, code: string, message: string): string {
  const value = body[field];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new ReviewError(422, code, message);
}

function dueDate(body: Body): string {
  const value = body.due_date;
  if (value === undefined || value === null || value === "") {
    throw new ReviewError(422, "due_date_required", "O prazo é obrigatório.");
  }
  if (typeof value !== "string" || !isRealDate(value)) {
    throw new ReviewError(422, "due_date_invalid", "O prazo deve ser uma data válida no formato AAAA-MM-DD.");
  }
  return value;
}

export function createApp(db: DatabaseSync, { now = () => new Date() }: Clock = {}) {
  const app = new Hono<{ Variables: { actor: Actor } }>();

  app.onError((err, c) => {
    if (err instanceof ReviewError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.json({ error: "Erro interno.", code: "internal_error" }, 500);
  });

  app.use("/scripts*", async (c, next) => {
    const actor = scripts.resolveActor(db, c.req.header("x-actor"));
    if (!actor) throw new ReviewError(401, "actor_required", "Informe um X-Actor válido (brand:<id> ou creator:<id>).");
    c.set("actor", actor);
    await next();
  });

  app.post("/scripts", async (c) => {
    const body = await readBody(c);
    const title = text(body, "title", "title_required", "O título é obrigatório.");
    const content = text(body, "content", "content_required", "O conteúdo é obrigatório.");
    const campaignId = text(body, "campaign_id", "campaign_id_required", "A campanha é obrigatória.");
    return c.json(scripts.createScript(db, c.get("actor"), campaignId, title, content, now()), 201);
  });

  app.get("/scripts", (c) => {
    const status = c.req.query("status");
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new ReviewError(422, "status_invalid", `O status deve ser um de: ${STATUSES.join(", ")}.`);
    }
    return c.json({ scripts: scripts.listScripts(db, c.get("actor"), status, c.req.query("campaign_id")) });
  });

  app.get("/scripts/:id", (c) => c.json(scripts.getScript(db, c.req.param("id"), c.get("actor"))));

  app.post("/scripts/:id/change-requests", async (c) => {
    const body = await readBody(c);
    const reason = text(body, "reason", "reason_required", "O motivo da alteração é obrigatório.");
    const view = scripts.requestChanges(db, c.req.param("id"), c.get("actor"), reason, dueDate(body), now());
    return c.json(view, 201);
  });

  app.post("/scripts/:id/versions", async (c) => {
    const body = await readBody(c);
    const content = text(body, "content", "content_required", "O conteúdo é obrigatório.");
    return c.json(scripts.submitVersion(db, c.req.param("id"), c.get("actor"), content, now()), 201);
  });

  app.post("/scripts/:id/approve", (c) => c.json(scripts.approve(db, c.req.param("id"), c.get("actor"), now())));

  return app;
}
