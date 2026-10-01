---
id: run-common-failures
title: Типовые падения сборки
type: runbook
scope: [backend, java, spring]
tags: [troubleshooting, build, errors, maven]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Типовые падения сборки

| Симптом | Причина | Что делать |
|---|---|---|
| `Could not find a valid Docker environment` | не запущен Docker | запустить Docker, либо `-DskipITs` для проверки без интеграционных тестов |
| `Spotless check failed` | формат не соответствует стилю | `./mvnw spotless:apply`, затем закоммитить |
| `Rule violated for bundle ...: lines covered ratio is 0.6` | покрытие нового кода ниже порога | дописать тесты, порог не снижать (`conv-testing`) |
| `liquibase.exception.ValidationFailedException: checksum changed` | отредактирован применённый changeSet | вернуть исходный changeSet, изменение оформить новым |
| `LazyInitializationException` | обращение к LAZY-связи вне транзакции | `@EntityGraph` / `JOIN FETCH` в запросе, не `EAGER` |
| `Parameter 0 of constructor required a bean of type ...` | нет бина или пакет вне скана | объявить `@Bean` в `config`, проверить пакет |
| `Port 8080 already in use` | сервис уже запущен | остановить процесс либо `-Dserver.port=0` |
| `OWASP dependency-check: CVE-... HIGH` | уязвимая зависимость | обновить версию; подавление — только с обоснованием в MR |
| `MethodArgumentNotValidException` в интеграционном тесте | тест шлёт невалидный DTO | привести тестовые данные к контракту, валидацию не ослаблять |

## Правило

Если ошибка не из таблицы — разобрать причину, починить и **дополнить эту
таблицу** в том же MR. Так база растёт от реальных инцидентов.
