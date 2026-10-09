import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { seed } from "../src/seed.ts";

function setup(start = "2026-10-01T12:00:00.000Z") {
  let current = new Date(start);
  const db = openDatabase(":memory:");
  seed(db);
  const app = createApp(db, { now: () => current });
  return {
    app,
    setNow: (iso: string) => {
      current = new Date(iso);
    },
  };
}

type App = ReturnType<typeof setup>["app"];

const ANA = "creator:crt_ana";
const SP = "brand:brd_sp";

// Sem ator explícito, quem age é o dono natural da ação.
function post(app: App, path: string, body?: unknown, actor = /approve|change-requests/.test(path) ? SP : ANA) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ler(app: App, id: string, actor = SP) {
  return (await app.request(`/scripts/${id}`, { headers: { "x-actor": actor } })).json();
}

async function criar(app: App, campaign_id = "cmp_verao") {
  const res = await post(app, "/scripts", { campaign_id, title: "Unboxing", content: "Primeira versão" });
  return ((await res.json()) as { id: string }).id;
}

describe("revisão de roteiro", () => {
  it("percorre o fluxo completo e preserva as versões antigas", async () => {
    const { app, setNow } = setup("2026-10-01T12:00:00.000Z");

    const created = await post(app, "/scripts", {
      campaign_id: "cmp_verao",
      title: "Unboxing",
      content: "Primeira versão",
    });
    expect(created.status).toBe(201);
    const v1 = await created.json();
    const id = v1.id as string;
    expect(id).toMatch(/^scr_/);
    expect(v1).toEqual({
      id,
      title: "Unboxing",
      campaign_id: "cmp_verao",
      brand_id: "brd_sp",
      creator_id: "crt_ana",
      timezone: "America/Sao_Paulo",
      status: "in_review",
      waiting_on: "brand",
      allowed_actions: [],
      current_version: 1,
      versions: [
        {
          number: 1,
          content: "Primeira versão",
          submitted_at: "2026-10-01T12:00:00.000Z",
          late: false,
          status: "in_review",
        },
      ],
    });
    expect((await ler(app, id)).allowed_actions).toEqual(["request_changes", "approve"]);

    setNow("2026-10-02T12:00:00.000Z");
    const changed = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Mostrar o produto logo no início",
      due_date: "2026-10-09",
    });
    expect(changed.status).toBe(201);
    const afterChange = await changed.json();
    expect(afterChange.status).toBe("changes_requested");
    expect(afterChange.waiting_on).toBe("creator");
    expect(afterChange.allowed_actions).toEqual([]);
    expect((await ler(app, id, ANA)).allowed_actions).toEqual(["submit_version"]);

    setNow("2026-10-03T12:00:00.000Z");
    const second = await post(app, `/scripts/${id}/versions`, { content: "Segunda versão" });
    expect(second.status).toBe(201);
    const afterV2 = await second.json();
    expect(afterV2.status).toBe("in_review");
    expect(afterV2.waiting_on).toBe("brand");
    expect(afterV2.allowed_actions).toEqual([]);
    expect(afterV2.current_version).toBe(2);
    expect(afterV2.versions).toEqual([
      {
        number: 1,
        content: "Primeira versão",
        submitted_at: "2026-10-01T12:00:00.000Z",
        late: false,
        status: "changes_requested",
        change_request: {
          reason: "Mostrar o produto logo no início",
          due_date: "2026-10-09",
          requested_at: "2026-10-02T12:00:00.000Z",
        },
      },
      {
        number: 2,
        content: "Segunda versão",
        submitted_at: "2026-10-03T12:00:00.000Z",
        late: false,
        status: "in_review",
      },
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
      late: false,
      status: "approved",
      approved_at: "2026-10-04T12:00:00.000Z",
    });
  });

  it("rejeita criação sem título ou conteúdo", async () => {
    const { app } = setup();
    const semTitulo = await post(app, "/scripts", { campaign_id: "cmp_verao", content: "x" });
    expect(semTitulo.status).toBe(422);
    expect((await semTitulo.json()).code).toBe("title_required");
    const semConteudo = await post(app, "/scripts", { campaign_id: "cmp_verao", title: "x", content: "  " });
    expect(semConteudo.status).toBe(422);
    expect((await semConteudo.json()).code).toBe("content_required");
    const semCampanha = await post(app, "/scripts", { title: "x", content: "x" });
    expect(semCampanha.status).toBe(422);
    expect((await semCampanha.json()).code).toBe("campaign_id_required");
    const campanhaInexistente = await post(app, "/scripts", { campaign_id: "cmp_nada", title: "x", content: "x" });
    expect(campanhaInexistente.status).toBe(404);
    expect((await campanhaInexistente.json()).code).toBe("campaign_not_found");
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
        late: false,
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
    expect((await app.request("/scripts/scr_nada", { headers: { "x-actor": SP } })).status).toBe(404);
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
      const res = await app.request("/scripts", { method: "POST", body, headers: { "x-actor": ANA } });
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("invalid_body");
      const cr = await app.request(`/scripts/${id}/change-requests`, { method: "POST", body, headers: { "x-actor": SP } });
      expect(cr.status).toBe(422);
    }
  });

  it.each([
    ["sem X-Actor", undefined],
    ["com formato inválido", "ana"],
    ["com perfil desconhecido", "admin:crt_ana"],
    ["com id inexistente", "creator:crt_nada"],
  ])("devolve 401 %s", async (_nome, actor) => {
    const { app } = setup();
    const res = await app.request("/scripts", { headers: actor ? { "x-actor": actor } : {} });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("actor_required");
  });

  it("devolve 403 quando o perfil não é dono da ação, antes de checar o estado", async () => {
    const { app } = setup();
    const id = await criar(app);
    const aprovar = await post(app, `/scripts/${id}/approve`, undefined, ANA);
    expect(aprovar.status).toBe(403);
    expect((await aprovar.json()).code).toBe("forbidden");
    const versao = await post(app, `/scripts/${id}/versions`, { content: "x" }, SP);
    expect(versao.status).toBe(403);
    const criacao = await post(app, "/scripts", { campaign_id: "cmp_verao", title: "x", content: "x" }, SP);
    expect(criacao.status).toBe(403);
    expect((await ler(app, id)).status).toBe("in_review");
  });

  it.each(["creator:crt_bruno", "brand:brd_manaus"])("%s recebe 404 no roteiro da Ana", async (actor) => {
    const { app } = setup();
    const id = await criar(app);
    expect((await app.request(`/scripts/${id}`, { headers: { "x-actor": actor } })).status).toBe(404);
    expect((await post(app, `/scripts/${id}/approve`, undefined, actor)).status).toBe(404);
  });

  it("lista só o que o ator enxerga e filtra por status", async () => {
    const { app } = setup();
    const verao = await criar(app);
    const norte = await criar(app, "cmp_norte");
    await post(app, "/scripts", { campaign_id: "cmp_verao", title: "Do Bruno", content: "x" }, "creator:crt_bruno");
    await post(app, `/scripts/${verao}/approve`);
    const ids = async (path: string, actor: string) =>
      ((await (await app.request(path, { headers: { "x-actor": actor } })).json()).scripts as { id: string }[]).map(
        (s) => s.id,
      );

    expect(await ids("/scripts", SP)).toHaveLength(2);
    expect(await ids("/scripts", "brand:brd_manaus")).toEqual([norte]);
    expect((await ids("/scripts", ANA)).sort()).toEqual([verao, norte].sort());
    expect(await ids("/scripts?status=approved", SP)).toEqual([verao]);
    expect(await ids("/scripts?campaign_id=cmp_norte", ANA)).toEqual([norte]);
    const lista = await (await app.request("/scripts", { headers: { "x-actor": SP } })).json();
    expect(lista.scripts[0]).not.toHaveProperty("versions");
    const invalido = await app.request("/scripts?status=pronto", { headers: { "x-actor": SP } });
    expect(invalido.status).toBe(422);
    expect((await invalido.json()).code).toBe("status_invalid");
  });

  it.each([
    ["2026-10-10T02:59:59.999Z", false],
    ["2026-10-10T03:00:00.000Z", true],
  ])("versão enviada em %s tem late=%s", async (instante, late) => {
    const { app, setNow } = setup();
    const id = await criar(app);
    await post(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", due_date: "2026-10-09" });
    setNow(instante);
    const res = await post(app, `/scripts/${id}/versions`, { content: "Segunda" });
    expect(res.status).toBe(201);
    expect((await res.json()).versions.map((v: { late: boolean }) => v.late)).toEqual([false, late]);
  });

  it.each([
    ["cmp_norte", 201, "brand:brd_manaus", "Manaus, 23:30 do dia 9"],
    ["cmp_verao", 422, SP, "São Paulo, 00:30 do dia 10"],
  ])("prazo 2026-10-09 às 03:30Z na campanha %s devolve %i (%s, %s)", async (campanha, status, marca) => {
    const { app, setNow } = setup();
    const id = await criar(app, campanha);
    setNow("2026-10-10T03:30:00.000Z");
    const res = await post(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", due_date: "2026-10-09" }, marca);
    expect(res.status).toBe(status);
    if (status === 422) expect((await res.json()).code).toBe("due_date_passed");
  });
});
