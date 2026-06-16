# Промежуточный итог

Дата: 2026-06-16.

## Текущее состояние

Приложение доступно по адресу:

```text
https://g.order.mrhellko.ru/
```

`order.mrhellko.ru` продолжает обслуживаться отдельным существующим проектом.

## Реализовано

- Vite + TypeScript + Three.js каркас.
- Full-screen 3D-сцена.
- `OrbitControls` для камеры.
- HTTPS через существующий Caddy на VPS.
- Статическая раздача `/root/gravity-sim/dist`.
- Диагностика WebGPU и secure context в UI.
- CPU physics backend.
- WebGPU compute backend.
- Выбор backend: `Auto`, `CPU`, `WebGPU`.
- Fallback на CPU при ошибках WebGPU.
- Velocity Verlet интегратор.
- Softening factor.
- Fixed timestep.
- Управление `Start`, `Pause/Resume`, `Reset`.
- Изменение `G`.
- Изменение скорости времени.
- FPS и sim time.
- Сцена ориентирована как `XOY` плоскость, `Z` вверх.
- Выбор тела кликом по объекту.
- Выбор тела из списка снизу слева.
- Габаритный corner-box marker для выбранного тела.
- Инспектор выбранного тела.
- Редактирование имени, цвета, массы, радиуса, координат, скоростей и pinned-флага.
- Live-отображение координат, скоростей и ускорений во время симуляции.
- `Pinned/static` тела: не двигаются, имеют нулевые скорость/ускорение, но влияют на остальные тела.
- `Focus` как toggle-follow выбранного тела.
- Добавление и удаление тел.
- `Clear` для очистки сцены.
- Шлейфы/траектории тел в 3D-сцене.
- Переключатель видимости траекторий.
- Настройка максимальной длины траекторий.
- Ограничение памяти траекторий через bounded history.
- Unit-тесты CPU-физики.
- ESLint, Prettier, Vitest, production build.

## Проверки

Последний полный набор проверок:

```text
npm run test
npm run lint
npm run build
npm run format:check
npm audit
```

Состояние на момент фиксации:

- тесты проходят;
- lint проходит;
- build проходит;
- format check проходит;
- `npm audit` показывает `found 0 vulnerabilities`;
- `https://g.order.mrhellko.ru/` отвечает `HTTP/2 200`.

Известное предупреждение:

- Vite предупреждает о JS chunk больше 500 KB из-за Three.js и текущей монолитной сборки. Это не блокирует MVP.

## Инфраструктура

- Caddy находится в проекте `/root/ai-assistant`.
- В Caddy добавлен отдельный site block для `g.order.mrhellko.ru`.
- `/root/gravity-sim/dist` смонтирован read-only в Caddy container.
- Серверные расчеты физики не добавлялись.
- VPS используется только для раздачи статики.

## Текущие ограничения

- WebGPU runtime проверяется вручную в браузере; Node/Vitest не покрывает реальный WebGPU device.
- WebGPU backend сейчас делает readback в CPU для Three.js/WebGL renderer.
- Нет Web Worker fallback.
- Нет сохранения сцен в localStorage/JSON.
- Нет fixed timestep selector в UI.
- Нет явного scale bar.
- Нет undo/duplicate/random orbit.
- Нет полноценной палитры быстрых цветов.
- Нет collision/merge logic.

## Следующие приоритеты

1. UI для изменения fixed timestep и отображения масштаба.
2. Duplicate body и пресеты сцен.
3. Сохранение/загрузка сцен.
4. WebGPU/CPU сравнение в браузерном diagnostic mode.
5. Производительность: уменьшение readback, Web Worker fallback, затем Barnes-Hut или tiling.
