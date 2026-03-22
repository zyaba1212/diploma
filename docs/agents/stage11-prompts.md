# Stage 11 Prompts (post-launch / production operations & scaling)

**Общий промпт** для всех агентов на этом этапе выдаёт координатор **в чате** при старте этапа (в этот файл не копируется). Здесь — только секции **A–G**; маппинг ролей → букв: `AGENTS.md` (раздел Stage 11).

---

## A) RefactorGuardianAgent — preflight перед изменениями Stage 11

- Убедиться, что Stage 10 не регрессирует: headers, `apiError`/correlation id, секреты не в `NEXT_PUBLIC_*`.
- Зафиксировать список файлов, которые трогает Stage 11 (чтобы не разъехались контракты).

---

## B) ArchitectAgent — целевая архитектура «после релиза»

- Целевой профиль нагрузки (RPS, число инстансов, multi-region или нет).
- Где нужен **shared state** (Redis / аналог) для rate limit и сессий при multi-instance.
- План наблюдаемости: алерты по SLO из `docs/operations.md`, что считать инцидентом.

---

## C) DBPrismaAgent — БД под нагрузкой

- Connection pooling (рекомендации для PgBouncer / managed Postgres).
- Индексы под реальные запросы (proposals list, network bbox).
- Политика миграций при нулевом даунтайме (expand/contract при необходимости).

---

## D) BackendAPIAgent — масштабирование и устойчивость API

- Абстракция rate limit за интерфейсом (in-memory → Redis) без смены контрактов ответов `429`.
- Таймауты/circuit breaker для внешних прокси (tile/geocode) — по возможности без ломки API.
- Лимиты размера body для mutation routes (если ещё не везде едино).

---

## E) FrontendAgent — UX при деградации и CDN

- Поведение при медленной сети / таймаутах (skeleton, retry).
- Проверка совместимости с будущим CSP/HSTS на edge (без поломки кошелька/карты).

---

## F) TestingCIAgent — CI/CD post-launch

- Расширить smoke workflow или добавить nightly прогон (по желанию).
- Документировать политику: когда блокируем merge по `npm audit`.

---

## G) DocsEditorAgent — документация Stage 11

- Обновить `README.md`, `docs/architecture.md`, `docs/operations.md` ссылками на решения Stage 11.
- Добавить раздел «Post-launch» или обновить `docs/etapy.md`.

---

## Цель Stage 11 (кратко)

Закрепить **эксплуатацию в реальной среде**: масштабирование, общий rate limit, наблюдаемость и документация — **без изменения публичных API-контрактов** Stage 5–8, если не оговорено отдельно.
