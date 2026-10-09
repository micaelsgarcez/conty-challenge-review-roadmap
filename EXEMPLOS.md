# Exemplos de request e response

Execução real com `npm start` em 2026-10-09, banco novo, nesta ordem. O `id` e os horários mudam a cada execução.

## Criar roteiro

```
curl -s -X POST http://127.0.0.1:3003/scripts -H 'content-type: application/json' -d '{"title":"Unboxing","content":"Primeira versão"}'
```

Resposta:

```
{"id":"scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4","title":"Unboxing","timezone":"America/Sao_Paulo","status":"in_review","allowed_actions":["request_changes","approve"],"current_version":1,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:27:45.296Z","status":"in_review"}]}
HTTP 201
```

## Pedido sem motivo

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/change-requests -H 'content-type: application/json' -d '{"due_date":"2026-12-01"}'
```

Resposta:

```
{"error":"O motivo da alteração é obrigatório.","code":"reason_required"}
HTTP 422
```

## Pedido com prazo no passado

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/change-requests -H 'content-type: application/json' -d '{"reason":"Ajustar","due_date":"2026-10-01"}'
```

Resposta:

```
{"error":"O prazo já passou.","code":"due_date_passed"}
HTTP 422
```

## Pedido válido

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/change-requests -H 'content-type: application/json' -d '{"reason":"Mostrar o produto no início","due_date":"2026-12-01"}'
```

Resposta:

```
{"id":"scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4","title":"Unboxing","timezone":"America/Sao_Paulo","status":"changes_requested","allowed_actions":["submit_version"],"current_version":1,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:27:45.296Z","status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:27:45.347Z"}}]}
HTTP 201
```

## Nova versão

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/versions -H 'content-type: application/json' -d '{"content":"Segunda versão"}'
```

Resposta:

```
{"id":"scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4","title":"Unboxing","timezone":"America/Sao_Paulo","status":"in_review","allowed_actions":["request_changes","approve"],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:27:45.296Z","status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:27:45.347Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:27:45.360Z","status":"in_review"}]}
HTTP 201
```

## Aprovar

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/approve
```

Resposta:

```
{"id":"scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4","title":"Unboxing","timezone":"America/Sao_Paulo","status":"approved","allowed_actions":[],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:27:45.296Z","status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:27:45.347Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:27:45.360Z","status":"approved","approved_at":"2026-10-09T17:27:45.370Z"}]}
HTTP 200
```

## Nova versão após aprovação

```
curl -s -X POST http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4/versions -H 'content-type: application/json' -d '{"content":"Terceira"}'
```

Resposta:

```
{"error":"A ação \"submit_version\" não é permitida com o roteiro em \"approved\".","code":"invalid_transition"}
HTTP 409
```

## Consulta final

```
curl -s -X GET http://127.0.0.1:3003/scripts/scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4
```

Resposta:

```
{"id":"scr_768e97b7-81a8-438a-92d2-30d47a6fe2c4","title":"Unboxing","timezone":"America/Sao_Paulo","status":"approved","allowed_actions":[],"current_version":2,"versions":[{"number":1,"content":"Primeira versão","submitted_at":"2026-10-09T17:27:45.296Z","status":"changes_requested","change_request":{"reason":"Mostrar o produto no início","due_date":"2026-12-01","requested_at":"2026-10-09T17:27:45.347Z"}},{"number":2,"content":"Segunda versão","submitted_at":"2026-10-09T17:27:45.360Z","status":"approved","approved_at":"2026-10-09T17:27:45.370Z"}]}
HTTP 200
```
