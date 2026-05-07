# Geocode API (Nominatim proxy) — operations & SLO

См. реализацию: [`src/app/api/geocode/search/route.ts`](../src/app/api/geocode/search/route.ts), [`src/app/api/geocode/reverse/route.ts`](../src/app/api/geocode/reverse/route.ts), [`src/app/api/geocode/nearby/route.ts`](../src/app/api/geocode/nearby/route.ts), общий upstream — [`src/lib/geocode/nominatimUpstream.ts`](../src/lib/geocode/nominatimUpstream.ts), константы — [`src/lib/geocode/constants.ts`](../src/lib/geocode/constants.ts).

## Бюджет таймаутов

- **Исходящий Nominatim (сервер):** `GEOCODE_UPSTREAM_TIMEOUT_MS` = 10s.
- **Клиент → `/api/geocode/*`:** `GEOCODE_CLIENT_FETCH_TIMEOUT_MS` = 14s (запас относительно cold start + ответа route).
- **Next.js route:** `export const maxDuration = 60` (Vercel / длительные деградации upstream).

## Кэш и устойчивость

- **L1:** in-process TTL ([`src/lib/geocodeCache.ts`](../src/lib/geocodeCache.ts)) — search/nearby 5 мин, reverse 30 мин.
- **L2 (опционально):** при `REDIS_URL` и **без** `GEOCODE_DISABLE_REDIS=1` — JSON в Redis с теми же TTL; ключи `gc:data:v1:<sha256>`.
- **Stale-if-error:** при timeout / 5xx / circuit open / parse error отдаётся последний успешный ответ (память + Redis `gc:stale:v1:*`, TTL 7 дней). Ответ с пометкой **`X-Geocode-Stale: 1`**.
- **Coalescing:** параллельные запросы с одним `cacheKey` делят один upstream-вызов ([`src/lib/geocode/inflightCoalesce.ts`](../src/lib/geocode/inflightCoalesce.ts)).

## Rate limit (per client IP, in-memory или Redis)

- `geocode.search` / `geocode.reverse`: **90** запросов / 60s.
- `geocode.nearby`: **60** запросов / 60s.

## Circuit breaker (geocode)

Пороги мягче дефолта: `failureThreshold: 12`, `windowMs: 120s`, `cooldownMs: 20s` ([`src/lib/geocode/constants.ts`](../src/lib/geocode/constants.ts)).

## Наблюдаемость

- **Структурные логи** (одна JSON-строка на событие): `console.log(JSON.stringify({ scope: 'geocode', ... }))` через [`logGeocodeServerEvent`](../src/lib/geocode/observability.ts). Отключить шум локально: **`GEOCODE_DEBUG_LOG=0`**.
- **Заголовки ответа:** `x-correlation-id`, `x-geocode-ms`, `x-geocode-outcome` (`upstream_success` | `stale_fallback` | `cache_memory_hit` | `cache_redis_hit`), при stale — `x-geocode-stale: 1`.

### Примеры grep (baseline / алерты)

```bash
# логи приложения (Vercel / Docker): искать scope geocode
grep '"scope":"geocode"' logs.txt

# доля stale fallback за период
grep '"outcome":"stale_fallback"' logs.txt | wc -l
```

### Целевые ориентиры (SLO)

| Метрика | Цель |
|--------|------|
| Успешный JSON ответ (200, не 429) | ≥ 99% запросов при нормальной работе Nominatim |
| `upstream_timeout` / `circuit_open` | Редко; при росте — проверить egress IP, лимиты OSM, Redis |
| Клиент: сырое `signal is aborted without reason` | Не показывать пользователю — см. [`src/lib/clientGeocodeFetch.ts`](../src/lib/clientGeocodeFetch.ts) |

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `REDIS_URL` | Включить L2 geocode cache + stale backup в Redis (если не отключено явно). |
| `GEOCODE_DISABLE_REDIS=1` | Только L1 + память stale; без Redis для geocode. |
| `RATE_LIMIT_BACKEND=redis` + `REDIS_URL` | Общий rate-limit через Redis ([`src/lib/rateLimit.ts`](../src/lib/rateLimit.ts)). |
| `GEOCODE_DEBUG_LOG=0` | Отключить JSON-логи geocode на stdout. |
