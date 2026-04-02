# Визуализация Земли (3D глобус)

## Текущая реализация

Компонент `src/components/EarthScene.tsx` отображает сферу с **фотореалистичными текстурами** из набора официальных примеров three.js:

| Текстура | Файл | Назначение |
|----------|------|------------|
| Цвет | `earth_atmos_2048.jpg` | Диффузная карта (континенты, океаны, атмосфера) |
| Normal | `earth_normal_2048.jpg` | Рельеф для освещения |
| Specular | `earth_specular_2048.jpg` | Блики на воде (через `specularMap` в `MeshPhongMaterial`) |
| Облака | `earth_clouds_1024.png` | Отдельная сфера чуть больше радиуса с прозрачностью |

Освещение: `HemisphereLight` + `AmbientLight` + направленный «солнечный» `DirectionalLight`, рендер с `ACESFilmicToneMapping` и `outputColorSpace = sRGB`.

### Читаемость при overlay (UX Globe phase)

- Если в 2D показываются границы/страны через Leaflet-слой, в 3D важно не “утопить” детали читаемости тяжёлым overlay.
- При необходимости обеспечивать видимость за счёт более светлого/мягкого рендера (tone mapping/exposure/фон), а не за счёт добавления сложных геометрических границ в 3D.

### Осветление сцены (чтобы элементы сети читались)

- Добиваться различимости кабелей/узлов на глобусе за счёт:
  - фона сцены (цвет `scene.background`),
  - экспозиции tone mapping (например, `renderer.toneMappingExposure`),
  - emissive-фоллбэка материала Земли (`emissive` / `fallbackMat`) для сохранения читаемости при разных материалах (`MeshPhongMaterial` vs `MeshStandardMaterial`).

## Загрузка текстур

По умолчанию файлы подгружаются с **https://threejs.org/examples/textures/planets/** (нужен доступ в интернет).

### Офлайн / собственный CDN

1. Скопируйте в `public/textures/earth/` файлы с теми же именами, что в таблице выше (можно взять из [репозитория three.js](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)).
2. В `.env.local`:

```env
NEXT_PUBLIC_EARTH_TEXTURE_BASE=/textures/earth/
```

Перезапустите `npm run dev`.

## Поведение сцены

- Сеть (`networkGroup`) — **дочерняя группа глобуса** (`globeGroup`): кабели и узлы вращаются вместе с планетой при перетаскивании.
- Звёзды остаются в мировых координатах и не крутятся с Землёй.

## Site Skeleton v2 (маршруты и header)

- Маршрут `Home` — `/`: описание проекта + доступ к интерактивной сети через кнопку `Глобальная сеть`.
- Маршрут `About` — `/about`: кратко про автора `Zybliyenko`.
- Страница интерактивной сети (EarthScene) — `/global-network` (с переключением 3D/2D).
- Хедер в v2 без left-nav: по центру только `Главная` и (в шапке) кнопка `Глобальная сеть`.
- Кнопка `Глобальная сеть` видна только на `/` и `/about` (на остальных страницах скрыта).

## Качество и производительность

- **По умолчанию (без `.env`):** сфера **224×224** сегментов, материал **`MeshStandardMaterial`** (PBR-lite); фон сцены тёмный — `GLOBE_SCENE_BACKGROUND_HEX` в `globeAppearance.ts`.
- **`NEXT_PUBLIC_EARTH_QUALITY=high`** — **256** сегментов (максимум в коде), материал Standard; **`NEXT_PUBLIC_EARTH_SPHERE_SEGMENTS` при этом не читается** (чтобы старое значение в `.env` не «ломало» high). Max DPR рендера по умолчанию **3** (см. `NEXT_PUBLIC_EARTH_MAX_PIXEL_RATIO`).
- **`NEXT_PUBLIC_EARTH_QUALITY=low`** — **96** сегментов + **Phong** — для слабых GPU.
- Если **`NEXT_PUBLIC_EARTH_QUALITY` не задан**, можно задать только `NEXT_PUBLIC_EARTH_SPHERE_SEGMENTS` (32–256) и при необходимости `NEXT_PUBLIC_EARTH_MATERIAL`.
- Анизотропная фильтрация текстур до возможностей GPU (`renderer.capabilities.getMaxAnisotropy()`), явный clamp по краям UV.
- При слабом железе: `low`, или меньше сегментов / текстур 1024px локально.

## Честно: это не «максимальное» качество планеты

Базово используется **набор примеров three.js** (`earth_*_2048.jpg`, облака 1024px). По умолчанию ренер идёт через **`MeshStandardMaterial`** — заметно приятнее освещение, чем чистый Phong на тех же текстурах.

### Как поднять качество ещё выше

1. **Пресет «high»** (ещё более гладкая сфера):

```env
NEXT_PUBLIC_EARTH_QUALITY=high
```

2. **Тонкая настройка** (все переменные опциональны):

| Переменная | Назначение |
|------------|------------|
| `NEXT_PUBLIC_EARTH_SPHERE_SEGMENTS` | Сегменты (32–256), **только если `NEXT_PUBLIC_EARTH_QUALITY` не задан**; иначе пресет quality главнее. |
| `NEXT_PUBLIC_EARTH_MATERIAL` | `phong` или `standard` — **только если quality не задан**; при `high`/`low` материал фиксируется пресетом. |
| `NEXT_PUBLIC_EARTH_MAX_PIXEL_RATIO` | Верхний предел `devicePixelRatio` для WebGL (1–4); при `high` по умолчанию 3. |
| `NEXT_PUBLIC_EARTH_TEXTURE_BASE` | Базовый URL или `/textures/earth/` для локальных файлов. |
| `NEXT_PUBLIC_EARTH_MAP_FILE` | Имя файла цветовой карты (по умолчанию `earth_atmos_2048.jpg`). |
| `NEXT_PUBLIC_EARTH_NORMAL_FILE` | Нормаль (по умолчанию `earth_normal_2048.jpg`). |
| `NEXT_PUBLIC_EARTH_SPECULAR_FILE` | Specular / маска воды для Phong (по умолчанию `earth_specular_2048.jpg`). |
| `NEXT_PUBLIC_EARTH_CLOUDS_FILE` | Облака (по умолчанию `earth_clouds_1024.png`). |

3. **Текстуры выше 2048** — положите в `public/textures/earth/` (или свой CDN) и укажите имена через переменные выше; для **NASA Visible Earth** и др. проверяйте условия использования. Полный PBR с **env map** и отражениями океана в коде не включён (можно добавить позже).

4. **Слабое железо** — `NEXT_PUBLIC_EARTH_QUALITY=low` или `NEXT_PUBLIC_EARTH_SPHERE_SEGMENTS=64`.

### Верхняя планка индустрии

Это **не** максимум по сравнению с:

- **8K+** текстурами и тяжёлыми ассетами;
- полноценным **PBR + environment map**;
- движками уровня **Cesium** для геодезии.

Без смены логики сцены можно подменять только текстуры и env-переменные.

## UX управление: 3D/2D и зум

В текущей реализации `src/components/EarthScene.tsx`:

- 3D/2D переключение:
  - есть кнопки в панели “Режим”: `3D` и `2D`;
  - auto-переход по зуму в `2D` отключён: переходы `3D <-> 2D` выполняются только явным действием пользователя.
- Зум:
  - управляется колесом мыши/тачпадом (wheel);
  - значение `camera.position.z` ограничено clamp’ом в диапазоне примерно `1.2..6`;
  - текущий zoom показывается рядом с переключателями.

Когда включён `MAP_2D`, карта рисуется как оверлей поверх сцены (через `MapView`), а при переключении возвращается к “чистой” 3D-сцене.

## Визуализация кабелей/элементов сети

Цвета по типам (используются и в 3D, и в 2D):

- `CABLE_FIBER`: `#7aa2ff`
- `CABLE_COPPER`: `#f6c177`
- `SATELLITE`: `#9fe7ff`
- остальные узлы/типы: `#b3c3ff` (в текущем минимальном отображении)

В 2D (`src/components/MapView.tsx`) на карте:

- для `CABLE_FIBER`/`CABLE_COPPER` рисуются полилинии по `element.path` (lat/lng);
- для элементов с `lat/lng` рисуются circleMarker’ы.

## Про “страницу сети” (EarthScene)

В текущей реализации интерактивная страница EarthScene доступна по маршруту `/global-network`:

- она открывается через кнопку `Глобальная сеть` в шапке (видна только на `/` и `/about`);
- она использует `/api/network?scope=GLOBAL` и отображает underground cables + base stations вместе с прочими узлами;
- в 2D используется Leaflet `MapView` (center/sync + user location + settlement search).

Для совместимости остаётся legacy alias `/cables`, который показывает ту же страницу EarthScene.

Минимальная “кабельная” информация также остаётся на глобусе/карте:
- линии кабелей на глобусе/карте;
- в панели “Данные” показывается количество `providers` и `elements`.
