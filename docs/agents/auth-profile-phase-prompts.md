# Auth / Profile / Username — промпты агентов (A–G)

Файл для **координатора** и **агентов**: прочитать **общий промпт**, затем выполнить **только свою букву**. Маппинг — в конце файла и в `AGENTS.md` (раздел «Auth / Profile phase»).

**Контекст продукта:** вход через кошелёк — аналог «входа через Google»: после подключения кошелька пользователь **авторизуется** подписью сообщения (уже есть `/api/auth/verify`).

Далее **username**:
- при первом входе, если `User.username` пустой, **username создаётся на сервере автоматически** (валидный по `src/lib/username.ts`) и сохраняется в БД с `usernameSetAt = null`;
- если `usernameSetAt === null` (ник был сгенерирован автоматически), пользователь может **переопределить** username в `Cabinet` через подпись;
- если `usernameSetAt != null`, смена username запрещена (или должна следовать политике секции B).

Важно: `pubkey` в UI больше не показывать как “адрес кошелька” (см. секцию F).

---

## Общий промпт (вставить в чат агенту)

```
Ты работаешь по файлу docs/agents/auth-profile-phase-prompts.md.

1) Прочитай этот файл целиком (секции A–G).
2) Определи свою букву (A–G) по своей роли из таблицы маппинга в конце файла или в AGENTS.md → «Auth / Profile phase»; выполни ТОЛЬКО эту секцию.
3) Сверяйся с docs/requirements.md, docs/architecture.md, prisma/schema.prisma; публичные API не ломай без пометки breaking change.
4) После изменений: npm run lint && npm run build; кратко DEVELOPMENT_JOURNAL.md.

Разрешение на правки в репозитории: от координатора.
```

---

## A) RefactorGuardianAgent — preflight

- Не ломать текущий поток: `POST /api/auth/verify`, сессия/куки если появятся — явно документировать.
- Список затрагиваемых зон: `User` в Prisma, новые маршруты `/api/profile/*` или `/api/user/*`, страница `/cabinet` / `/profile`.
- Аудит UI на отображение `pubkey`: `src/components/AuthBlock.tsx`, `src/app/cabinet/page.tsx`, `src/app/moderate/page.tsx`.
- Сценарий “после `POST /api/auth/verify` профиль должен обновиться в UI”: предусмотреть refetch/force reload профиля.
- Согласовать с B единый формат: **подпись сообщения** vs **транзакция** для переопределения username (сложность, UX Phantom).

---

## B) ArchitectAgent — целевая модель

- **Username:** правила (длина, символы, уникальность), генерация random username на сервере при первом входе.
- **`usernameSetAt`:** семантика статуса:
  - `null` => username авто-сгенерирован, можно заменить;
  - `!= null` => username задан пользователем, смена запрещена (если нет отдельной политики).
- **Личный кабинет:** что видит гость vs подключённый vs авторизованный vs задавший username (с учётом авто-username).
- **Доказательство владения:** для переопределения username — подпись off-chain сообщения; зафиксировать формат в `docs/architecture.md` (и/или связать с `src/lib/username.ts`).

---

## C) DBPrismaAgent — схема пользователя

- Расширить `User`: поле `username` (nullable → unique), `usernameSetAt` опционально; миграция без потери существующих `pubkey`.
- Индексы под поиск по username; ограничения уникальности.

---

## D) Web3SolanaAgent — подпись для username

- Если выбрано **сообщение:** формат строки `diploma-z96a username\npubkey=...\nusername=...\nts=...`, проверка на бэкенде как в auth.
- Если выбрана **транзакция:** минимальный инструкции/контракт на devnet — только если согласовано в B (не раздувать scope без нужды).
- Клиент: хуки/утилиты для подписи в UI кабинета.

---

## E) BackendAPIAgent — API профиля

- `POST /api/auth/verify`: после успешной верификации подписи — убедиться, что пользователь в БД. Если у пользователя пустой `username`, сгенерировать random username и сохранить в БД, выставив `usernameSetAt = null`.
- `GET /api/profile`: вернуть `username` и `usernameSetAt` (и `inDatabase` в едином формате JSON, как уже принято в проекте).
- `POST /api/profile/username`: переопределение username только если `usernameSetAt === null`; после успешной установки выставить `usernameSetAt = now`.
- Bulk endpoint для `Moderate`:
  - цель: заменить `authorPubkey` на `username` в `src/app/moderate/page.tsx`;
  - вход: массив `pubkeys: string[]`;
  - выход: `pubkey -> username` (для неизвестных pubkey вернуть `null` или пропустить; фронт должен быть устойчив).
- Не хранить приватные ключи; логи без PII лишнего.

---

## F) FrontendAgent — личный кабинет

- `AuthBlock` (`src/components/AuthBlock.tsx`):
  - убрать показ `pubkey` как адрес кошелька;
  - показывать `username` после загрузки профиля;
  - после успешного `POST /api/auth/verify` инициировать refetch профиля, чтобы `Cabinet` справа обновился сразу.
- `Cabinet` (`src/app/cabinet/page.tsx`):
  - убрать строку с `pubkey` полностью;
  - показывать username и форму переопределения только когда `usernameSetAt === null`.
- `Moderate` (`src/app/moderate/page.tsx`):
  - заменить колонку Author: показывать username вместо `authorPubkey`;
  - после загрузки списка `SUBMITTED` предложений собрать pubkeys и вызвать bulk endpoint (из E).
- Состояния загрузки и ошибок (401/403/409/429) для всех fetch.

---

## G) DocsEditorAgent + TestingCIAgent

- Docs: `README.md`, `docs/architecture.md` — поток «кошелёк → авторизация → серверный random username → переопределение (если usernameSetAt===null)».
- Тесты/smoke:
  - после первого входа должен появиться username из БД и `usernameSetAt === null`;
  - `POST /api/profile/username` успешно устанавливает username и после этого смена отклоняется;
  - smoke/UI чек: `AuthBlock`/`Cabinet`/`Moderate` не показывают pubkey как адрес.

---

## Маппинг буква → роль (Auth / Profile phase)

| Буква | Агент |
|-------|--------|
| **A** | RefactorGuardianAgent |
| **B** | ArchitectAgent |
| **C** | DBPrismaAgent |
| **D** | Web3SolanaAgent |
| **E** | BackendAPIAgent |
| **F** | FrontendAgent |
| **G** | DocsEditorAgent и TestingCIAgent |

---

## Цель фазы (кратко)

Уникальный **username** привязан к **pubkey**: при первом входе он генерируется случайно на сервере, затем пользователь (если `usernameSetAt===null`) может переопределить username через подпись. `pubkey` в UI больше не показывается; профиль обновляется сразу после `POST /api/auth/verify`.
