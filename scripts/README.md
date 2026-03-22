# Scripts

## Sync submarine cables

```bash
npm run scripts:sync-cables
```

## Sync satellites

```bash
npm run scripts:sync-satellites
```

Оба скрипта ожидают, что `DATABASE_URL` настроен (через `.env.local`).

## Rollback drill

Проверка `GET /api/health` и вывод чеклиста отката (см. `docs/release-hardening.md`):

```bash
npm run ops:rollback-drill
```

Переменная `BASE_URL` по умолчанию `http://localhost:3000`.

## Smoke: экстент сети (API)

После сида/импорта — счётчики по типам и bbox (см. `docs/network-data-sources.md`):

```bash
npm run scripts:smoke-network-extent
```

## RSS новости → БД (cron)

Требует запущенный Next.js и `CRON_SECRET` (см. `docs/operations.md`). На Vercel см. [`vercel.json`](../vercel.json) — почасовой вызов без секрета в env для cron.

**Bash:**

```bash
CRON_SECRET=your-secret npm run scripts:sync-news
```

**Windows PowerShell:** секрет только из **ASCII** (без кириллицы в значении — иначе ошибка ByteString в заголовке).

```powershell
$env:CRON_SECRET = "local-dev-secret-change-me"
npm run scripts:sync-news
```

