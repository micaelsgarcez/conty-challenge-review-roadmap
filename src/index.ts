import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { seed } from "./seed.ts";

const dbPath = process.env.DB_PATH ?? "data/roteiros.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const port = Number(process.env.PORT ?? 3003);

const db = openDatabase(dbPath);
seed(db);

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`revisão de roteiro em http://127.0.0.1:${info.port}`);
});
