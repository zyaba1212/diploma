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

