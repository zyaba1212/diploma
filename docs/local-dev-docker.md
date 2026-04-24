# Локальная разработка: PostgreSQL в Docker (Windows)

## Как устроены «агенты» в этом проекте

В `AGENTS.md` роли (**DBPrismaAgent**, **BackendAPIAgent** и т.д.) — это **соглашение для людей**: кто за что отвечает и какие файлы трогать.

**Cursor не перекидывает задачи между отдельными ИИ-агентами сам.** Один чат = один ассистент. Если нужен «чистый» DBPrisma-контур — открой **отдельный чат** с промптом вида: «Ты DBPrismaAgent, сделай только миграции/схему по `AGENTS.md`».

Ниже — **порядок команд**, который по смыслу лежит на **DBPrismaAgent + координаторе**.

---

## 1. Уже есть Postgres на 5432 (например `z96a-pg`)

Если **`docker ps`** показывает контейнер вроде **`z96a-pg`** с портом **`0.0.0.0:5432->5432`**, **второй** контейнер с Postgres на том же порту поднимать **не нужно** — будет ошибка `port is already allocated`.

Действия:

1. В **`.env.local`** укажи `DATABASE_URL` на **`localhost:5432`**, база **`diploma`**, user/password **как в том контейнере** (часто совпадают с `.env.example`: `postgres` / `postgres`; если при создании контейнера задавали иначе — подставь свои).
2. Создай БД `diploma`, если её ещё нет: через `psql` или GUI, либо Prisma создаст при первом подключении (в зависимости от прав пользователя).

Отдельный раздел ниже — если Postgres **ещё нет** и поднимаешь новый контейнер `diploma-postgres`.

---

## 1b. Образ уже скачан — новый контейнер только если порта 5432 нет

Скачивание `postgres:16` **не запускает** сервер, пока не выполнен успешный `docker run` (или не запущен уже созданный контейнер).

Проверка:

```powershell
docker ps -a --filter name=diploma-postgres
```

- Статус **Up** — контейнер работает, порт проброшен.
- Статус **Exited** — запусти: `docker start diploma-postgres`
- Контейнера нет — выполни `docker run` (см. README или блок ниже).

Повторный запуск с теми же параметрами, что в `.env.example`:

```powershell
docker run -d --name diploma-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=diploma `
  -p 5432:5432 `
  postgres:16
```

Если имя `diploma-postgres` уже занято — удали старый контейнер или выбери другое имя.

---

## 2. Переменные окружения

В корне проекта должен быть **`.env.local`** (копия с `.env.example`), минимум:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/diploma?schema=public"
```

`localhost` и порт **5432** должны совпадать с `docker run -p 5432:5432`.

---

## 3. Команды Prisma (зона DBPrismaAgent)

Из каталога корня проекта (например `C:\diploma2\diploma`):

```powershell
npm i
npm run prisma:generate
```

Накатить миграции на БД:

```powershell
npx prisma migrate deploy
```

Для интерактивной разработки с созданием новых миграций:

```powershell
npm run prisma:migrate
```

Опционально сиды:

```powershell
npm run db:seed
```

---

## 4. Проверка

```powershell
npm run dev
```

В браузере: `http://localhost:3000/api/network?scope=GLOBAL` — ожидается **200**, не 500.

---

## 5. Типичные ошибки

| Ошибка | Действие |
|--------|----------|
| `P1001` / Can't reach `localhost:5432` | Docker Desktop запущен? Контейнер `Up`? Порт в `DATABASE_URL` = проброшенный порт? |
| Порт 5432 занят | Другой Postgres на машине — смени `-p 5433:5432` и в `DATABASE_URL` порт **5433**. |
| Имя контейнера занято | `docker rm -f diploma-postgres` (данные в контейнере без volume пропадут) и снова `docker run`. |
| `error during connect` / `dockerDesktopLinuxEngine` / `pipe` | См. раздел **ниже** — демон Docker не отвечает. |

---

## 6. Ошибка `dockerDesktopLinuxEngine` / `failed to start containers`

Сообщение вида:

`Post "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/.../start"`

означает: **CLI Docker виден, а движок Docker Desktop (Linux) не отвечает** или ещё не поднялся.

**Что сделать по порядку:**

1. Полностью **закрой Docker Desktop** (правый клик по иконке в трее → Quit).
2. Запусти **Docker Desktop** снова и подожди, пока статус станет **Running** (не «Starting»).
3. Проверь: `docker info` — без ошибки в конце.
4. Повтори: `docker ps` (должно отработать без ошибки подключения).

Если не помогает:

- **Обнови Docker Desktop** до последней стабильной версии.
- В Docker Desktop → **Settings → General**: включи **Use the WSL 2 based engine** (если доступно).
- Убедись, что **WSL 2** установлен (`wsl --status` в PowerShell).
- Временно отключи VPN/фильтры, которые режут локальные named pipes (редко, но бывает).

---

## 7. Не используйте `...` в команде `docker run`

В документации `...` означает «остальные параметры опущены». В консоли нужно ввести **полную** команду со всеми `-e`, иначе контейнер создастся **без** пользователя/БД или команда завершится с ошибкой.

**Пример с портом 5433** (если 5432 занят на хосте) — скопируй **целиком**:

```powershell
docker run -d --name diploma-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=diploma `
  -p 5433:5432 `
  postgres:16
```

В `.env.local` тогда:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/diploma?schema=public"
```

Проверка:

```powershell
docker ps
```

Должна быть строка `diploma-postgres` со статусом **Up** и колонкой **PORTS** вида `0.0.0.0:5433->5432/tcp`.

---

## 8. Сброс dev-БД (`migrate reset`)

**Удаляет все данные** в базе из `DATABASE_URL` и заново накатывает миграции. Только для локальной разработки.

```powershell
npx prisma migrate reset
```

Подтверждение в интерактивном режиме или:

```powershell
npx prisma migrate reset --force
```

История миграций сведена к **одной baseline** (`20260201000000_baseline_schema`), сгенерированной из `schema.prisma`. Старые инкрементные папки Stage 6–12 удалены как дублирующие схему.

Если миграции падали с `current transaction is aborted`, частая причина была **вложенный `BEGIN`/`COMMIT` внутри SQL** при том, что Prisma уже оборачивает миграцию в транзакцию.

---

## Кратко для координатора

1. **Инфра**: Docker + контейнер Postgres `Up` на нужном порту (часто уже есть `z96a-pg`).  
2. **DBPrisma**: `.env.local` → `migrate deploy` / при проблемах в dev — `migrate reset --force` → опционально `db:seed`.  
3. **Проверка**: `npm run dev` + `/api/network`.
