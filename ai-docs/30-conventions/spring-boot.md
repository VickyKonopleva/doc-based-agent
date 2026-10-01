---
id: conv-spring-boot
title: Конвенции Spring Boot
type: convention
scope: [backend, java, spring]
tags: [spring, boot, configuration, profiles, properties, beans]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Конвенции Spring Boot

Версия: Spring Boot 3.x, Java 21, сборка Maven (`./mvnw`).

## Конфигурация

Свойства — через типизированные `@ConfigurationProperties`, не через `@Value`.

```java
@ConfigurationProperties(prefix = "payment.gateway")
@Validated
public record GatewayProperties(
        @NotBlank String baseUrl,
        @NotNull Duration connectTimeout,
        @NotNull Duration readTimeout,
        @Min(1) @Max(5) int maxRetries
) {}
```

```yaml
payment:
  gateway:
    base-url: ${PAYMENT_GATEWAY_URL}
    connect-timeout: 2s
    read-timeout: 5s
    max-retries: 3
```

Правила:

- Значения, различающиеся между средами, приходят из переменных окружения.
- `application.yml` — общая часть; `application-<profile>.yml` — различия.
- Профиль `local` допускает дефолты; `prod` обязан падать при отсутствии
  обязательного свойства.
- Секреты никогда не лежат в репозитории (`conv-security`).

## Бины

- Конфигурационные классы — в пакете `config`.
- Явный `@Bean` предпочтительнее `@Component` для инфраструктурных объектов.
- `@Primary` и `@Qualifier` — только при реальной неоднозначности.
- Никакой логики в конструкторе бина, кроме присваивания полей.

## Транзакции

- `@Transactional` — на методе доменного/прикладного сервиса.
- Для чтения — `@Transactional(readOnly = true)`.
- Внешние вызовы (HTTP, Kafka) не внутри транзакции БД.
- Самовызов `@Transactional`-метода не работает — выносить в отдельный бин.

## Актуаторы

Открываются только `health`, `info`, `prometheus`. Остальное закрыто.

```yaml
management:
  endpoints.web.exposure.include: health,info,prometheus
  endpoint.health.probes.enabled: true
```

## Нельзя

- `@ComponentScan` с расширением базового пакета.
- `@EnableAutoConfiguration` вручную.
- `spring.jpa.hibernate.ddl-auto` где-либо кроме `none` (см. `conv-persistence`).
- `@Value` для чего-то сложнее одной строки.
- Бизнес-логика в `@PostConstruct`.
