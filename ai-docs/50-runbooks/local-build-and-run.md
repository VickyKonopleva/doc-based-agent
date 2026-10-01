---
id: run-local-build
title: Локальная сборка и запуск
type: runbook
scope: [backend, java, spring]
tags: [maven, build, run, docker, testcontainers]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Локальная сборка и запуск

## Предусловия

- JDK 21 (`java -version` → 21).
- Docker Desktop запущен — без него не работают Testcontainers.
- Maven не нужен глобально: используется wrapper `./mvnw`.

## Команды

```bash
./mvnw -q clean verify          # полная проверка: компиляция, тесты, стиль, покрытие
```

```bash
./mvnw -q test                  # только unit-тесты, быстро
```

```bash
./mvnw -q verify -DskipITs      # без интеграционных тестов (Docker не нужен)
```

```bash
./mvnw -q spotless:apply        # починить форматирование
```

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

## Что обязан прогнать агент перед MR

```bash
./mvnw -q clean verify
```

Только зелёная сборка. Если падает — чинить причину, а не тест.

## Проверка одного теста

```bash
./mvnw -q test -Dtest=PaymentServiceTest#shouldRejectPayment_whenAmountIsNegative
```

## Профили

| Профиль | Назначение |
|---|---|
| `local` | локальный запуск, дефолты вместо секретов |
| `test` | автотесты, Testcontainers |
| `prod` | без дефолтов, падает при отсутствии обязательных свойств |
