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

A API sobe em `http://127.0.0.1:3003` e grava em `data/roteiros.sqlite`. `PORT` e `DB_PATH` mudam isso (veja `.env.example`).

## Estados

O estado do roteiro é o estado da versão mais recente. Toda resposta traz `status` e `allowed_actions`, então o cliente não precisa deduzir o próximo passo.

| `status` | Quem age | `allowed_actions` |
| --- | --- | --- |
| `in_review` | marca | `request_changes`, `approve` |
| `changes_requested` | criador | `submit_version` |
| `approved` | ninguém | nenhuma |

Uma tabela em `src/scripts.ts` (`ALLOWED`) decide as transições e preenche `allowed_actions`. Uma ação fora da tabela devolve `409 invalid_transition`. Por isso um roteiro aprovado não aceita nova versão, novo pedido de alteração nem nova aprovação.

## Endpoints

| Método e caminho | Corpo | Sucesso |
| --- | --- | --- |
| `POST /scripts` | `{ "title", "content" }` | 201, versão 1 em `in_review` |
| `GET /scripts/:id` | | 200 |
| `POST /scripts/:id/change-requests` | `{ "reason", "due_date": "AAAA-MM-DD" }` | 201 |
| `POST /scripts/:id/versions` | `{ "content" }` | 201, nova versão em `in_review` |
| `POST /scripts/:id/approve` | | 200 |

Os erros têm a forma `{ "error": "mensagem", "code": "codigo" }`. A ordem de checagem é `422` para o formato do corpo, depois `404 script_not_found`, depois `409 invalid_transition`, depois `422 due_date_passed`. Os outros códigos de 422 do pedido de alteração são `reason_required`, `due_date_required` e `due_date_invalid`.

[`EXEMPLOS.md`](EXEMPLOS.md) traz o fluxo inteiro com curl e as respostas reais.

## Prazo

O prazo é um dia (`2026-10-09`), não um instante. O pedido vale se esse dia for hoje ou depois em `America/Sao_Paulo`. `src/deadline.ts` calcula o dia de hoje com `Intl.DateTimeFormat` nesse fuso e compara as datas. Não corta a data em UTC.

Com prazo `2026-10-09`:

- `2026-10-10T01:00:00.000Z` aceita. Em UTC já é dia 10, em São Paulo ainda é 22:00 do dia 9.
- `2026-10-10T02:59:59.999Z` aceita. É o último instante do dia 9 em São Paulo.
- `2026-10-10T03:00:00.000Z` recusa com `due_date_passed`. É meia-noite do dia 10 em São Paulo.

Os testes controlam o relógio passando `now` para `createApp`.

## O que ficou de fora

- Autenticação e papéis. Qualquer cliente chama as rotas da marca e as do criador.
- Listagem de roteiros e vínculo com campanha, marca ou criador.
- O prazo só é checado quando a marca cria o pedido. Uma versão enviada depois do prazo é aceita, para não perder conteúdo, e nada marca que ela chegou atrasada.
- O fuso é fixo em `America/Sao_Paulo`.

## O que eu faria diferente com mais tempo

- Guardar o fuso no cadastro da marca, em vez de uma constante.
- Ligar a tabela de transições ao papel autenticado, para que só a marca peça alteração ou aprove, e só o criador envie versão.
- Decidir com o produto o que acontece quando o prazo vence sem nova versão. Hoje o roteiro fica em `changes_requested` sem limite. Eu marcaria a versão como atrasada ou deixaria a marca renovar o prazo.
- Usar controle de concorrência otimista (`If-Match` com o número da versão). Hoje `transition` em `src/scripts.ts` é síncrona, então a checagem de estado e a escrita rodam sem `await` entre elas. Isso basta para um processo com SQLite, mas não para vários processos no mesmo banco.
- Guardar os eventos (pedido, envio, aprovação) numa tabela própria. Hoje cada versão guarda no máximo um pedido de alteração ou uma aprovação, o que cobre o fluxo pedido mas não um histórico de comentários.

## Uso de IA

- Feito com IA (Claude Code): leitura dos dois desafios anteriores para seguir a mesma stack, a proposta do modelo de dados (status na versão, tabela de transições), o código, os testes, a execução com curl de `EXEMPLOS.md` e este README. Na revisão do código, a IA achou e corrigiu uma condição de corrida: um pedido de alteração concorrente com a aprovação sobrescrevia a aprovação. O teste "aprovação concorrente com pedido de alteração deixa só uma vencer" reproduz o caso.
- Revisado por mim: o modelo de estados, a regra do prazo e os testes de borda do dia, as decisões listadas em "O que ficou de fora" e o texto deste README.
