# Задача: видимость OSM + data.gov.au на карте / метаданные WFS

Общий контекст: импорты OpenStreetMap (медные кабели, базовые станции) и подземное ВОЛС City of Gold Coast (data.gov.au WFS) географически сосредоточены у **~−28° / 153°E**. Центр глобуса по умолчанию в приложении — **30°N, 0°E**, поэтому без fit bounds данные «не видны». Публичный контракт **`GET /api/network`** не меняется.

**Букву секции A–G выбери сам** по роли и таблице в [`AGENTS.md`](../AGENTS.md) (UX / Globe phase или ad-hoc mapping в конце файла).

---

## RefactorGuardianAgent

- Не менять сигнатуры `/api/network`, `/api/tile`, `/api/geocode/*`.
- Новые поля только в `NetworkElement.metadata` или клиентской утилите; схема Prisma — только по отдельной задаче.
- Проверить отсутствие секретов в логах импорта.

---

## ThreeLeafletAgent

- Утилиты bbox: [`src/lib/geo/networkBounds.ts`](../../src/lib/geo/networkBounds.ts) — `selectBoundsForMapFocus`, `computeRegionalDataBounds` (исключает мировые подводные кабели из авто-fit).
- [`MapView`](../../src/components/MapView.tsx): `autoFitBounds` + `fitBounds` при готовности карты.
- [`EarthScene`](../../src/components/EarthScene.tsx): кнопка «К области данных», подсказка в легенде.
- Регрессии: переход 3D↔2D, `syncGlobeToMapCenter`.

---

## FrontendAgent

- При необходимости: отображение `metadata.wfs` / `metadata.wfsRaw` в карточке hover (не блокер).
- Легенда уже содержит пояснение про региональный слой.

---

## ScriptsImportAgent

- [`scripts/sync-underground-cables.mjs`](../../scripts/sync-underground-cables.mjs): полный маппинг WFS `properties` → `metadata.wfs` + `wfsRaw`.
- [`scripts/sync-underground-copper-cables-osm.mjs`](../../scripts/sync-underground-copper-cables-osm.mjs): предупреждение при 0 ways в bbox.
- Smoke: `npm run scripts:smoke-network-extent` (см. [`scripts/smoke-network-data-extent.mjs`](../../scripts/smoke-network-data-extent.mjs)).

---

## DBPrismaAgent

- Не требуется для этой задачи (достаточно JSON `metadata`).

---

## TestingCIAgent

- Ручной smoke: поднять `npm run dev`, выполнить `npm run scripts:smoke-network-extent`.
- Опционально: unit-тест для `selectBoundsForMapFocus` на фикстурном JSON (низкий приоритет).

---

## DocsEditorAgent

- [`docs/network-data-sources.md`](../network-data-sources.md) — источники, bbox, `SEED_SCOPE`.

---

## Приёмка

```bash
npm run lint
npm run build
```

При наличии БД и сида: на `/global-network` в 2D карта должна автоматически приблизиться к региону Gold Coast; кнопка «К области данных» — центрировать 3D и 2D.

**Не задействовать:** Web3SolanaAgent, BackendAPIAgent (если нет правок API), Anchor.
