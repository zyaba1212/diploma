# Stage 10 Prompts (security + observability — production depth)

**Общий промпт** для всех агентов на этом этапе выдаёт координатор **в чате** при старте этапа (в этот файл не копируется). Здесь — только секции **A–G**; маппинг ролей → букв: `AGENTS.md` (раздел Stage 10).

Цель Stage 10: усилить безопасность и наблюдаемость для production без ломки публичных API-контрактов Stage 5–8.

Каждый агент выполняет только свою секцию (A-G) по маппингу из `AGENTS.md`.

---

## A) RefactorGuardianAgent — security/regression gate

- Проверить, что не добавлены секреты в клиентский бандл (`NEXT_PUBLIC_*` только публичное).
- Проверить отсутствие утечек `DATABASE_URL`/ключей в логах и в репозитории.
- Сверить `docs/secrets-policy.md` с фактическим использованием env в коде.

---

## B) ArchitectAgent — threat model + security architecture

- Краткий threat model: auth, API abuse, geocode/tile proxy, proposals mutation paths.
- Рекомендации по headers (CSP, HSTS, X-Frame-Options) для Next.js.
- План observability: что логировать, retention, PII policy.

---

## C) DBPrismaAgent — DB security baseline

- Least privilege для роли БД в production (не superuser).
- Рекомендации по шифрованию соединения (`sslmode` в `DATABASE_URL` где применимо).
- Аудит индексов для тяжёлых запросов под нагрузкой.

---

## D) BackendAPIAgent — hardening implementation

- Security headers через `next.config.mjs` или middleware (без breaking для Leaflet/wallet).
- Унификация ошибок 5xx (correlation id опционально).
- Расширение rate-limit policy при необходимости (документировать лимиты).

---

## E) FrontendAgent — client-safe UX

- CSP-совместимость кошелька и карт (не ломать Phantom/Leaflet).
- Явные сообщения при сетевых ошибках / 401 / 429.

---

## F) TestingCIAgent — security checks in CI

- Добавить опциональный шаг: `npm audit --audit-level=high` (или policy команды).
- Документировать, что делать при failed audit.

---

## G) DocsEditorAgent — sync docs

- Обновить `docs/architecture.md`, `docs/requirements.md` ссылками на Stage 10 решения.
- Проверить `docs/secrets-policy.md` и `docs/release-hardening.md` на актуальность после изменений.
