---
id: index
title: Карта базы знаний
type: meta
tags: [index, navigation]
status: active
updated: 2026-10-01
---

# Карта базы знаний

Порядок чтения для типовой задачи разработки:

1. `10-process/ticket-lifecycle.md` — что делать с номером тикета.
2. `60-glossary/glossary.md` — расшифровать термины из описания.
3. `40-projects/<сервис>.md` — карточка затронутого сервиса.
4. `20-architecture/*` — где в архитектуре находится изменение.
5. `30-conventions/*` — как именно писать код.
6. `10-process/definition-of-done.md` — чем задача считается завершённой.
7. `10-process/merge-request.md` — как оформить результат.

## Процесс

- `10-process/ticket-lifecycle.md` — от номера тикета до MR, пошагово.
- `10-process/branching-and-commits.md` — имена веток, формат коммитов.
- `10-process/merge-request.md` — заголовок, описание, чеклист MR.
- `10-process/definition-of-done.md` — критерии готовности.
- `10-process/code-review-checklist.md` — что проверит ревьюер.

## Архитектура

- `20-architecture/overview.md` — ландшафт, границы сервисов.
- `20-architecture/service-layering.md` — слои внутри сервиса.
- `20-architecture/integration-patterns.md` — REST, Kafka, идемпотентность, ретраи.
- `20-architecture/adr/` — принятые архитектурные решения.

## Конвенции кода

- `30-conventions/java-code-style.md` — стиль Java.
- `30-conventions/spring-boot.md` — Spring Boot: конфигурация, бины, профили.
- `30-conventions/rest-api.md` — контракты REST.
- `30-conventions/persistence.md` — JPA, транзакции, Liquibase.
- `30-conventions/error-handling.md` — исключения и коды ошибок.
- `30-conventions/logging-and-observability.md` — логи, метрики, трейсинг.
- `30-conventions/security.md` — секреты, авторизация, валидация.
- `30-conventions/testing.md` — пирамида тестов и требования к покрытию.

## Проекты

- `40-projects/_template.md` — шаблон карточки сервиса.
- `40-projects/payment-service.md` — пример заполненной карточки.

## Runbooks

- `50-runbooks/local-build-and-run.md` — сборка, тесты, запуск.
- `50-runbooks/agent-self-extension.md` — когда и как агент создаёт себе инструменты.
- `50-runbooks/common-failures.md` — типовые падения сборки и что с ними делать.

## Справочники

- `60-glossary/glossary.md` — домен и сокращения.
