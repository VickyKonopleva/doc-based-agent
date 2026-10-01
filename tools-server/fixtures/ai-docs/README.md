# fixtures/ai-docs — крошечная база знаний для тестов

Это **не** база знаний проекта: настоящая живёт вне репозитория, см.
`docs/connecting-ai-docs.md`. Здесь ровно столько документов, сколько нужно
`npm run smoke`, чтобы проверить `docs_read` и `docs_search` без доступа к
вашему Bitbucket.

Менять содержимое можно только вместе с ассертами в
`tools-server/scripts/smoke-test.mjs`.
