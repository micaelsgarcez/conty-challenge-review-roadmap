import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { isRealDate } from "./deadline.ts";
import * as scripts from "./scripts.ts";
import { ReviewError } from "./scripts.ts";

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
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ReviewError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.json({ error: "Erro interno.", code: "internal_error" }, 500);
  });

  app.post("/scripts", async (c) => {
    const body = await readBody(c);
    const title = text(body, "title", "title_required", "O título é obrigatório.");
    const content = text(body, "content", "content_required", "O conteúdo é obrigatório.");
    return c.json(scripts.createScript(db, title, content, now()), 201);
  });

  app.get("/scripts/:id", (c) => c.json(scripts.getScript(db, c.req.param("id"))));

  app.post("/scripts/:id/change-requests", async (c) => {
    const body = await readBody(c);
    const reason = text(body, "reason", "reason_required", "O motivo da alteração é obrigatório.");
    const view = scripts.requestChanges(db, c.req.param("id"), reason, dueDate(body), now());
    return c.json(view, 201);
  });

  app.post("/scripts/:id/versions", async (c) => {
    const body = await readBody(c);
    const content = text(body, "content", "content_required", "O conteúdo é obrigatório.");
    return c.json(scripts.submitVersion(db, c.req.param("id"), content, now()), 201);
  });

  app.post("/scripts/:id/approve", (c) => c.json(scripts.approve(db, c.req.param("id"), now())));

  return app;
}
