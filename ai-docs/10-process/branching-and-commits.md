---
id: proc-branching-commits
title: Ветки и коммиты
type: process
scope: [backend]
tags: [git, branch, commit, conventional-commits]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Ветки и коммиты

## Имя ветки

```
<type>/<TICKET>-<короткое-описание-через-дефис>
```

`type`: `feature` | `bugfix` | `hotfix` | `refactor` | `chore` | `docs`.
Описание — латиницей, в нижнем регистре, не длиннее 50 символов.

```
feature/BACK-1234-add-payment-retry
bugfix/BACK-1301-npe-on-empty-cart
```

Ветка создаётся от свежего целевого бранча:

```bash
git fetch origin
git switch -c feature/BACK-1234-add-payment-retry origin/master
```

## Сообщение коммита

Conventional Commits, первая строка — не длиннее 72 символов, с номером
тикета в скоупе:

```
feat(BACK-1234): add retry policy for payment callbacks

Платёжный шлюз отдаёт 503 при пиковой нагрузке. Добавлен экспоненциальный
ретрай с джиттером, максимум 3 попытки, идемпотентность по paymentId.

Refs: BACK-1234
```

Типы: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`.

## Правила

- Один коммит — одно логически завершённое изменение; сборка зелёная на каждом.
- Тело коммита объясняет **почему**, а не пересказывает диф.
- Breaking change помечается `!` и секцией `BREAKING CHANGE:` в теле.
- История ветки линейная: `git rebase origin/master`, не merge-коммиты.

## Нельзя

- `git commit -m "fix"`, `"wip"`, `"правки"`.
- `git push --force` в `master`/`release/*`; в своей ветке — только
  `--force-with-lease`.
- Смешивать форматирование всего файла с содержательным изменением.
- Коммитить сгенерированные артефакты (`target/`, `*.class`, `.idea/workspace.xml`).
