# Локальные текстуры Земли (опционально)

По умолчанию ожидаются имена из примеров three.js:

- `earth_atmos_2048.jpg` — цвет
- `earth_normal_2048.jpg` — нормаль
- `earth_specular_2048.jpg` — specular (для режима Phong)
- `earth_clouds_1024.png` — облака

Источник: [three.js examples/textures/planets](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)

Можно положить **более крупные** файлы (например 4K/8K) и задать имена через `.env.local`:

```
NEXT_PUBLIC_EARTH_TEXTURE_BASE=/textures/earth/
NEXT_PUBLIC_EARTH_MAP_FILE=my-earth-8k.jpg
NEXT_PUBLIC_EARTH_NORMAL_FILE=my-normal-8k.jpg
NEXT_PUBLIC_EARTH_SPECULAR_FILE=my-spec-8k.jpg
NEXT_PUBLIC_EARTH_CLOUDS_FILE=my-clouds-4k.png
```

Качество сетки и материала: см. `docs/earth-visualization.md` (`NEXT_PUBLIC_EARTH_QUALITY=high` и др.).
