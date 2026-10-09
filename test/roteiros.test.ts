import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

function setup(start = "2026-10-01T12:00:00.000Z") {
  let current = new Date(start);
  const app = createApp(openDatabase(":memory:"), { now: () => current });
  return {
    app,
    setNow: (iso: string) => {
      current = new Date(iso);
    },
  };
}

type App = ReturnType<typeof setup>["app"];

function post(app: App, path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ler(app: App, id: string) {
  return (await app.request(`/scripts/${id}`)).json();
}

async function criar(app: App) {
  const res = await post(app, "/scripts", { title: "Unboxing", content: "Primeira versão" });
  return ((await res.json()) as { id: string }).id;
}

describe("revisão de roteiro", () => {
  it("percorre o fluxo completo e preserva as versões antigas", async () => {
    const { app, setNow } = setup("2026-10-01T12:00:00.000Z");

    const created = await post(app, "/scripts", { title: "Unboxing", content: "Primeira versão" });
    expect(created.status).toBe(201);
    const v1 = await created.json();
    const id = v1.id as string;
    expect(id).toMatch(/^scr_/);
    expect(v1).toEqual({
      id,
      title: "Unboxing",
      timezone: "America/Sao_Paulo",
      status: "in_review",
      allowed_actions: ["request_changes", "approve"],
      current_version: 1,
      versions: [
        { number: 1, content: "Primeira versão", submitted_at: "2026-10-01T12:00:00.000Z", status: "in_review" },
      ],
    });

    setNow("2026-10-02T12:00:00.000Z");
    const changed = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Mostrar o produto logo no início",
      due_date: "2026-10-09",
    });
    expect(changed.status).toBe(201);
    const afterChange = await changed.json();
    expect(afterChange.status).toBe("changes_requested");
    expect(afterChange.allowed_actions).toEqual(["submit_version"]);

    setNow("2026-10-03T12:00:00.000Z");
    const second = await post(app, `/scripts/${id}/versions`, { content: "Segunda versão" });
    expect(second.status).toBe(201);
    const afterV2 = await second.json();
    expect(afterV2.status).toBe("in_review");
    expect(afterV2.allowed_actions).toEqual(["request_changes", "approve"]);
    expect(afterV2.current_version).toBe(2);
    expect(afterV2.versions).toEqual([
      {
        number: 1,
        content: "Primeira versão",
        submitted_at: "2026-10-01T12:00:00.000Z",
        status: "changes_requested",
        change_request: {
          reason: "Mostrar o produto logo no início",
          due_date: "2026-10-09",
          requested_at: "2026-10-02T12:00:00.000Z",
        },
      },
      { number: 2, content: "Segunda versão", submitted_at: "2026-10-03T12:00:00.000Z", status: "in_review" },
    ]);

    setNow("2026-10-04T12:00:00.000Z");
    const approved = await post(app, `/scripts/${id}/approve`);
    expect(approved.status).toBe(200);
    const final = await approved.json();
    expect(final.status).toBe("approved");
    expect(final.allowed_actions).toEqual([]);
    expect(final.versions[1]).toEqual({
      number: 2,
      content: "Segunda versão",
      submitted_at: "2026-10-03T12:00:00.000Z",
      status: "approved",
      approved_at: "2026-10-04T12:00:00.000Z",
    });
  });

  it("rejeita criação sem título ou conteúdo", async () => {
    const { app } = setup();
    const semTitulo = await post(app, "/scripts", { content: "x" });
    expect(semTitulo.status).toBe(422);
    expect((await semTitulo.json()).code).toBe("title_required");
    const semConteudo = await post(app, "/scripts", { title: "x", content: "  " });
    expect(semConteudo.status).toBe(422);
    expect((await semConteudo.json()).code).toBe("content_required");
  });

  it.each([
    ["sem motivo", { due_date: "2026-10-09" }, "reason_required"],
    ["com motivo em branco", { reason: "   ", due_date: "2026-10-09" }, "reason_required"],
    ["sem prazo", { reason: "Ajustar" }, "due_date_required"],
    ["com data inexistente", { reason: "Ajustar", due_date: "2026-02-30" }, "due_date_invalid"],
    ["com data e hora", { reason: "Ajustar", due_date: "2026-10-09T23:00:00Z" }, "due_date_invalid"],
  ])("rejeita pedido de alteração %s e mantém o roteiro em revisão", async (_nome, body, code) => {
    const { app } = setup();
    const id = await criar(app);
    const res = await post(app, `/scripts/${id}/change-requests`, body);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe(code);
    const after = await ler(app, id);
    expect(after.status).toBe("in_review");
  });

  it.each([
    ["2026-10-10T02:59:59.999Z", 201, "último instante do dia em São Paulo ainda vale"],
    ["2026-10-10T01:00:00.000Z", 201, "UTC já virou para o dia 10, mas em São Paulo ainda é dia 9"],
    ["2026-10-10T03:00:00.000Z", 422, "meia-noite em São Paulo: o prazo passou"],
  ])("prazo 2026-10-09 em %s devolve %i (%s)", async (instante, status) => {
    const { app, setNow } = setup();
    const id = await criar(app);
    setNow(instante);
    const res = await post(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", due_date: "2026-10-09" });
    expect(res.status).toBe(status);
    if (status === 422) expect((await res.json()).code).toBe("due_date_passed");
  });

  it("roteiro aprovado não aceita nova versão, pedido de alteração nem nova aprovação", async () => {
    const { app } = setup();
    const id = await criar(app);
    await post(app, `/scripts/${id}/approve`);
    const antes = await ler(app, id);

    const versao = await post(app, `/scripts/${id}/versions`, { content: "Outra" });
    expect(versao.status).toBe(409);
    expect(await versao.json()).toEqual({
      error: 'A ação "submit_version" não é permitida com o roteiro em "approved".',
      code: "invalid_transition",
    });
    const alteracao = await post(app, `/scripts/${id}/change-requests`, { reason: "x", due_date: "2026-12-01" });
    expect(alteracao.status).toBe(409);
    expect((await post(app, `/scripts/${id}/approve`)).status).toBe(409);

    const depois = await ler(app, id);
    expect(depois.status).toBe("approved");
    expect(depois.allowed_actions).toEqual([]);
    expect(depois.versions).toEqual(antes.versions);
  });

  it("aprovação concorrente com pedido de alteração deixa só uma vencer", async () => {
    const { app } = setup();
    const id = await criar(app);
    const [alteracao, aprovacao] = await Promise.all([
      post(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", due_date: "2026-12-01" }),
      post(app, `/scripts/${id}/approve`),
    ]);
    expect([alteracao.status, aprovacao.status].sort()).toEqual([200, 409]);
    const depois = await ler(app, id);
    expect(depois.status).toBe("approved");
    expect(depois.versions).toEqual([
      {
        number: 1,
        content: "Primeira versão",
        submitted_at: "2026-10-01T12:00:00.000Z",
        status: "approved",
        approved_at: "2026-10-01T12:00:00.000Z",
      },
    ]);
  });

  it("respeita o dono de cada ação conforme o estado", async () => {
    const { app } = setup();
    const id = await criar(app);
    const versao = await post(app, `/scripts/${id}/versions`, { content: "Outra" });
    expect(versao.status).toBe(409);
    expect((await versao.json()).code).toBe("invalid_transition");

    await post(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", due_date: "2026-12-01" });
    const aprovar = await post(app, `/scripts/${id}/approve`);
    expect(aprovar.status).toBe(409);
    expect((await aprovar.json()).error).toContain("changes_requested");
  });

  it("devolve 404 para roteiro inexistente", async () => {
    const { app } = setup();
    expect((await app.request("/scripts/scr_nada")).status).toBe(404);
    for (const [path, body] of [
      ["/scripts/scr_nada/change-requests", { reason: "x", due_date: "2026-12-01" }],
      ["/scripts/scr_nada/versions", { content: "x" }],
      ["/scripts/scr_nada/approve", undefined],
    ] as const) {
      const res = await post(app, path, body);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("script_not_found");
    }
  });

  it("devolve 422 para corpo que não é um objeto JSON", async () => {
    const { app } = setup();
    const id = await criar(app);
    for (const body of ["{quebrado", "[1]", "null", '"texto"']) {
      const res = await app.request("/scripts", { method: "POST", body });
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("invalid_body");
      const cr = await app.request(`/scripts/${id}/change-requests`, { method: "POST", body });
      expect(cr.status).toBe(422);
    }
  });
});
