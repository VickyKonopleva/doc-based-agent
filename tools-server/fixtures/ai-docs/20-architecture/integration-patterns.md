---
id: arch-integration
title: "Интеграции: REST, Kafka, устойчивость"
type: architecture
scope: [backend, java, spring]
tags: [kafka, rest, retry, idempotency, outbox, timeout]
status: active
owner: architecture-chapter
updated: 2026-10-01
---

# Интеграции

## Kafka

Консьюмер идемпотентен: доставка at-least-once, дубликаты неизбежны.
Необрабатываемое сообщение уходит в DLT, а не роняет консьюмер.

## Идемпотентность

Операция, меняющая состояние, принимает ключ идемпотентности. Результат первой
обработки сохраняется и возвращается при повторе.

## Нельзя

- Вызов без таймаута.
- Ретрай неидемпотентного POST.
