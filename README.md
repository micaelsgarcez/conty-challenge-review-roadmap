# Conty. Revisão de roteiro

API em que a marca revisa o roteiro do criador antes do vídeo. Cada envio do criador vira uma versão nova. A marca pede alteração ou aprova a versão atual. Nenhuma versão é apagada.

## Como rodar

Node 22 ou mais novo.

```bash
npm install
npm test
npm run typecheck
npm start
```

A API sobe em `http://127.0.0.1:3003` e grava em `data/roteiros.sqlite`. `PORT` e `DB_PATH` mudam isso (veja `.env.example`). Na subida, `src/seed.ts` cadastra duas marcas, dois criadores e duas campanhas:

| Quem | `X-Actor` | Fuso | Campanha |
| --- | --- | --- | --- |
| Marca SP | `brand:brd_sp` | `America/Sao_Paulo` | `cmp_verao` |
| Marca Manaus | `brand:brd_manaus` | `America/Manaus` | `cmp_norte` |
| Ana | `creator:crt_ana` | | |
| Bruno | `creator:crt_bruno` | | |

## Estados

O estado do roteiro é o estado da versão mais recente. Toda resposta traz `status`, `waiting_on` (quem precisa agir) e `allowed_actions` (o que quem chamou pode fazer agora), então o cliente não precisa deduzir o próximo passo.

| `status` | `waiting_on` | Ações |
| --- | --- | --- |
| `in_review` | `brand` | `request_changes`, `approve` |
| `changes_requested` | `creator` | `submit_version` |
| `approved` | `null` | nenhuma |

Duas tabelas em `src/scripts.ts` decidem tudo. `ALLOWED` diz que ações cada estado aceita, e `ROLE` diz quem faz cada ação. Uma ação de outro papel devolve `403 forbidden`. Uma ação fora do estado devolve `409 invalid_transition`. Por isso um roteiro aprovado não aceita nova versão, novo pedido de alteração nem nova aprovação.

## Papéis

O cabeçalho `X-Actor: brand:<id>` ou `X-Actor: creator:<id>` diz quem chama. Sem ele, ou com um id que não existe, a resposta é `401 actor_required`. Isso separa os papéis, mas não é autenticação. Qualquer cliente pode se passar por qualquer marca ou criador.

O criador cria o roteiro numa campanha e envia as versões. A marca dona da campanha pede alteração e aprova. Cada um só vê os próprios roteiros. Para os outros, o roteiro responde `404`.

## Endpoints

| Método e caminho | Quem | Corpo | Sucesso |
| --- | --- | --- | --- |
| `POST /scripts` | criador | `{ "campaign_id", "title", "content" }` | 201, versão 1 em `in_review` |
| `GET /scripts?status=&campaign_id=` | os dois | | 200, `{ "scripts": [...] }` sem as versões |
| `GET /scripts/:id` | os dois | | 200 |
| `POST /scripts/:id/change-requests` | marca | `{ "reason", "due_date": "AAAA-MM-DD" }` | 201 |
| `POST /scripts/:id/versions` | criador | `{ "content" }` | 201, nova versão em `in_review` |
| `POST /scripts/:id/approve` | marca | | 200 |

Os erros têm a forma `{ "error": "mensagem", "code": "codigo" }`. A ordem de checagem é esta:

1. `401 actor_required`.
2. `422` para o formato do corpo (`reason_required`, `due_date_required`, `due_date_invalid`, entre outros).
3. `404 script_not_found`.
4. `403 forbidden`.
5. `409 invalid_transition`.
6. `422 due_date_passed`.

[`EXEMPLOS.md`](EXEMPLOS.md) traz o fluxo inteiro com curl e as respostas reais.

## Prazo

O prazo é um dia (`2026-10-09`), não um instante. O pedido vale se esse dia for hoje ou depois no fuso da marca dona da campanha. `src/deadline.ts` calcula o dia de hoje com `Intl.DateTimeFormat` nesse fuso e compara as datas. Não corta a data em UTC.

Com prazo `2026-10-09` numa marca de `America/Sao_Paulo`:

- `2026-10-10T01:00:00.000Z` aceita. Em UTC já é dia 10, em São Paulo ainda é 22:00 do dia 9.
- `2026-10-10T02:59:59.999Z` aceita. É o último instante do dia 9 em São Paulo.
- `2026-10-10T03:00:00.000Z` recusa com `due_date_passed`. É meia-noite do dia 10 em São Paulo.

No instante `2026-10-10T03:30:00.000Z`, o mesmo prazo vale para a marca de Manaus (23:30 do dia 9) e não vale para a de São Paulo (00:30 do dia 10).

Uma versão enviada depois do prazo é aceita, para não perder conteúdo, e sai com `late: true`. O cálculo usa a mesma regra do dia. Os testes controlam o relógio passando `now` para `createApp`.

## O que ficou de fora

- Autenticação de verdade. `X-Actor` só separa os papéis.
- Convite de criador para campanha. Qualquer criador cria roteiro em qualquer campanha que exista.
- Cadastro de marcas, criadores e campanhas pela API. Eles vêm do seed.
- Paginação na listagem.
- Migração de schema. Se você tem um `data/roteiros.sqlite` de uma versão anterior, apague a pasta `data`.

## O que eu faria diferente com mais tempo

- Trocar `X-Actor` por um token e manter as tabelas `ALLOWED` e `ROLE` como estão.
- Decidir com o produto o que acontece quando o prazo vence sem nova versão. Hoje o roteiro fica em `changes_requested` sem limite e a versão só chega marcada como atrasada. Eu deixaria a marca renovar o prazo.
- Usar controle de concorrência otimista (`If-Match` com o número da versão). Hoje `transition` em `src/scripts.ts` é síncrona, então a checagem de estado e a escrita rodam sem `await` entre elas. Isso basta para um processo com SQLite, mas não para vários processos no mesmo banco.
- Guardar os eventos (pedido, envio, aprovação) numa tabela própria. Hoje cada versão guarda no máximo um pedido de alteração ou uma aprovação, o que cobre o fluxo pedido mas não um histórico de comentários.
- A listagem faz uma consulta de versões por roteiro para derivar o estado. Com volume, eu guardaria o estado atual numa coluna do roteiro, atualizada na mesma escrita.

## Uso de IA

- Feito com IA (Claude Code): leitura dos dois desafios anteriores para seguir a mesma stack, a proposta do modelo de dados (status na versão, tabelas de transição e de papel), o código, os testes, a separação de papéis por `X-Actor`, a listagem, a marcação de versão atrasada, o fuso por marca, a execução com curl de `EXEMPLOS.md` e este README. Na revisão do código, a IA achou e corrigiu uma condição de corrida: um pedido de alteração concorrente com a aprovação sobrescrevia a aprovação. O teste "aprovação concorrente com pedido de alteração deixa só uma vencer" reproduz o caso.
- Revisado por mim: o modelo de estados, a regra do prazo e os testes de borda do dia, a escolha de uma separação de papéis simples em vez de autenticação, as decisões listadas em "O que ficou de fora" e o texto deste README.
