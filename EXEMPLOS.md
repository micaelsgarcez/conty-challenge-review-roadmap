# Exemplos de request e response

Execução real com `npm start` em 2026-10-09, banco novo com o seed, nesta ordem. O `id` e os horários mudam a cada execução. O cabeçalho `X-Actor` diz quem chama: `creator:crt_ana` cria e envia versões, `brand:brd_sp` pede alteração e aprova.

## Criar roteiro

```
curl -s -X POST http://127.0.0.1:3003/scripts -H 'X-Actor: creator:crt_ana' -H 'content-type: application/json' -d '{"campaign_id":"cmp_verao","title":"Unboxing","content":"Primeira versão"}'
```

Resposta:

```
{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"in_review","waiting_on":"brand","allowed_actions":[],"current_version":1,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:57:14.639Z","late":false,"status":"in_review"}]}
HTTP 201
```

## Criar sem X-Actor

```
curl -s -X POST http://127.0.0.1:3003/scripts -H 'content-type: application/json' -d '{"campaign_id":"cmp_verao","title":"x","content":"x"}'
```

Resposta:

```
{"error":"Informe um X-Actor válido (brand:<id> ou creator:<id>).","code":"actor_required"}
HTTP 401
```

## Criador tenta aprovar

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/approve -H 'X-Actor: creator:crt_ana'
```

Resposta:

```
{"error":"Um perfil \"creator\" não pode executar a ação \"approve\".","code":"forbidden"}
HTTP 403
```

## Pedido sem motivo

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/change-requests -H 'X-Actor: brand:brd_sp' -H 'content-type: application/json' -d '{"due_date":"2026-12-01"}'
```

Resposta:

```
{"error":"O motivo da alteração é obrigatório.","code":"reason_required"}
HTTP 422
```

## Pedido com prazo no passado

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/change-requests -H 'X-Actor: brand:brd_sp' -H 'content-type: application/json' -d '{"reason":"Ajustar","due_date":"2026-10-01"}'
```

Resposta:

```
{"error":"O prazo já passou.","code":"due_date_passed"}
HTTP 422
```

## Pedido válido

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/change-requests -H 'X-Actor: brand:brd_sp' -H 'content-type: application/json' -d '{"reason":"Mostrar o produto no início","due_date":"2026-12-01"}'
```

Resposta:

```
{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"changes_requested","waiting_on":"creator","allowed_actions":[],"current_version":1,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:57:14.639Z","late":false,"status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:57:14.724Z"}}]}
HTTP 201
```

## Nova versão

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/versions -H 'X-Actor: creator:crt_ana' -H 'content-type: application/json' -d '{"content":"Segunda versão"}'
```

Resposta:

```
{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"in_review","waiting_on":"brand","allowed_actions":[],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:57:14.639Z","late":false,"status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:57:14.724Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:57:14.735Z","late":false,"status":"in_review"}]}
HTTP 201
```

## Aprovar

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/approve -H 'X-Actor: brand:brd_sp'
```

Resposta:

```
{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"approved","waiting_on":null,"allowed_actions":[],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:57:14.639Z","late":false,"status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:57:14.724Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:57:14.735Z","late":false,"status":"approved","approved_at":"2026-10-09T17:57:14.744Z"}]}
HTTP 200
```

## Nova versão após aprovação

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e/versions -H 'X-Actor: creator:crt_ana' -H 'content-type: application/json' -d '{"content":"Terceira"}'
```

Resposta:

```
{"error":"A ação \"submit_version\" não é permitida com o roteiro em \"approved\".","code":"invalid_transition"}
HTTP 409
```

## Consulta final

```
curl -s -X GET http://127.0.0.1:3003/scripts/scr_7d777e04-e15a-4c08-941b-e81318f1ed1e -H 'X-Actor: brand:brd_sp'
```

Resposta:

```
{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"approved","waiting_on":null,"allowed_actions":[],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:57:14.639Z","late":false,"status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:57:14.724Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:57:14.735Z","late":false,"status":"approved","approved_at":"2026-10-09T17:57:14.744Z"}]}
HTTP 200
```

## Marca lista os roteiros

```
curl -s -X GET http://127.0.0.1:3003/scripts -H 'X-Actor: brand:brd_sp'
```

Resposta:

```
{"scripts":[{"id":"scr_7d777e04-e15a-4c08-941b-e81318f1ed1e","title":"Unboxing","campaign_id":"cmp_verao","brand_id":"brd_sp","creator_id":"crt_ana","timezone":"America/Sao_Paulo","status":"approved","waiting_on":null,"allowed_actions":[],"current_version":2}]}
HTTP 200
```
