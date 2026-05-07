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

## Песочница — регрессии draft / карта–глобус

Автотеста в репозитории нет; проверка вручную в одной вкладке браузера:

1. `/sandbox`: выставить оборудование → «Глобус» → «Карта» — маркеры и кабели должны совпадать с списком «Узлы».
2. Уйти на другую страницу и вернуться на `/sandbox` — черновик восстанавливается из `sessionStorage` (`sandbox-draft-v1`).
3. Новая вкладка / закрытие вкладки — черновик только в рамках сессии вкладки (как у `sessionStorage`).

