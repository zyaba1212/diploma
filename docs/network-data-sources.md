# Источники данных сети (импорт)

## Подземное ВОЛС — data.gov.au (City of Gold Coast)

- Каталог: [Fibre Optic Cable](https://data.gov.au/data/dataset/fibre-optic-cable).
- WFS GeoJSON по умолчанию задаётся в `scripts/sync-underground-cables.mjs` (`UNDERGROUND_CABLE_GEO_URL`).
- Лицензия: **CC BY 3.0 Australia**; атрибуция и формулировка про уточнение на месте — в скрипте импорта.
- География: **узкий регион** (Gold Coast, Queensland). На глобальном масштабе линии едва видны без приближения.
- В `NetworkElement.metadata` сохраняются поля WFS: см. `wfs` и полный снимок `wfsRaw` (импорт).

## OpenStreetMap (Overpass)

- Подземная медь, базовые станции: `scripts/sync-underground-copper-cables-osm.mjs`, `scripts/sync-base-stations-osm.mjs`.
- Bbox по умолчанию выводится из геометрии подземного ВОЛС или fallback около Gold Coast.
- Лицензия: **ODbL 1.0** — атрибуция OSM.

## Почему «не видно на карте»

1. Центр сцены по умолчанию (`GLOBE_DEFAULT_CENTER` в `src/lib/three/globeAppearance.ts`) не совпадает с Австралией — используйте **«К области данных»** или режим **2D** (авто-fit по региональному слою).
2. **`SEED_SCOPE=LOCAL`** кладёт элементы в `scope=LOCAL`, а страница глобальной сети запрашивает **`scope=GLOBAL`** — данные не попадут в выборку. Для демо оставляйте `GLOBAL` или добавьте отдельный UI для LOCAL.

## Проверка

```bash
npm run scripts:smoke-network-extent
# при необходимости:
BASE_URL=http://localhost:3000 npm run scripts:smoke-network-extent
```
