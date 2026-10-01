---
id: conv-persistence
title: БД, JPA и миграции
type: convention
scope: [backend, java, spring]
tags: [jpa, hibernate, liquibase, postgres, migration, transaction, index]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# БД, JPA и миграции

СУБД — PostgreSQL. Схема меняется **только** миграциями Liquibase.

## Миграции

```
src/main/resources/db/changelog/
├── db.changelog-master.yaml
└── changes/
    └── 2026-10-01-BACK-1234-add-payment-retry-count.yaml
```

- Имя файла: `<дата>-<TICKET>-<описание>.yaml`.
- Один changeSet — одно изменение, с обязательным `rollback`.
- Применённый changeSet не редактируется никогда: исправление — новый changeSet.
- `ddl-auto: none` во всех профилях.

```yaml
databaseChangeLog:
  - changeSet:
      id: BACK-1234-add-retry-count
      author: backend-agent
      changes:
        - addColumn:
            tableName: payment
            columns:
              - column: { name: retry_count, type: int, defaultValueNumeric: 0,
                          constraints: { nullable: false } }
      rollback:
        - dropColumn: { tableName: payment, columnName: retry_count }
```

## Именование в БД

- Таблицы и колонки — `snake_case`, таблица в единственном числе: `payment`.
- Первичный ключ — `id`.
- Внешний ключ — `<таблица>_id`, индекс `idx_<таблица>_<колонки>`,
  ограничение уникальности `uk_<таблица>_<колонки>`.

## JPA

- `FetchType.LAZY` для всех связей; `EAGER` запрещён.
- Загрузка графа — `JOIN FETCH` или `@EntityGraph`, не `n` отдельных запросов.
- `@Version` для оптимистичной блокировки на изменяемых агрегатах.
- Без `CascadeType.REMOVE` на связях между агрегатами.
- `equals`/`hashCode` — по бизнес-ключу, не по `id` и не через Lombok.

```java
@Entity
@Table(name = "payment")
public class PaymentEntity {

    @Id
    private UUID id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private PaymentStatus status;

    @OneToMany(mappedBy = "payment", fetch = FetchType.LAZY)
    private List<PaymentAttemptEntity> attempts = new ArrayList<>();
}
```

## Производительность

- Любой новый запрос в списковом эндпоинте — с индексом.
- Массовые операции — батчами, не построчно в цикле.
- Долгие миграции на больших таблицах — `CREATE INDEX CONCURRENTLY`, отдельным
  changeSet с `runInTransaction: false`.

## Нельзя

- `ddl-auto: update`.
- Нативный SQL со склейкой строк из пользовательского ввода.
- `@Enumerated(EnumType.ORDINAL)`.
- Изменение существующего changeSet.
- `SELECT *` в нативных запросах.
