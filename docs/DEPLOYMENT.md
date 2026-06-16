# Деплой `g.order.mrhellko.ru`

## DNS

Для работы HTTPS поддомен должен резолвиться на VPS:

```text
g.order.mrhellko.ru A 2.27.41.138
```

Отдельная A-запись не нужна только если у зоны уже есть wildcard-запись:

```text
*.order.mrhellko.ru A 2.27.41.138
```

Фактическая проверка на 2026-06-15:

- `order.mrhellko.ru` резолвится в `2.27.41.138`;
- `g.order.mrhellko.ru` не резолвится;
- значит для `g.order.mrhellko.ru` нужна отдельная A-запись или wildcard.

## HTTPS

WebGPU требует secure context. Для публичного адреса нужен `https://g.order.mrhellko.ru`; `http://2.27.41.138:5173` будет показывать `WebGPU: insecure context`.

На VPS уже работает Caddy в проекте `/root/ai-assistant`, который занимает порты 80/443 и обслуживает `order.mrhellko.ru`.

Безопасный способ публикации:

- оставить существующий site block `order.mrhellko.ru` без изменений по поведению;
- добавить отдельный site block `g.order.mrhellko.ru`;
- отдавать `/root/gravity-sim/dist` как read-only статику;
- не добавлять backend API для расчетов;
- не запускать Node.js runtime в production;
- использовать существующий Caddy для автоматического Let's Encrypt.

## Проверки

До изменения:

```text
docker ps
getent hosts order.mrhellko.ru
getent hosts g.order.mrhellko.ru
curl -fsS https://order.mrhellko.ru/health
```

После изменения:

```text
docker compose -f /root/ai-assistant/docker-compose.yml config
docker compose -f /root/ai-assistant/docker-compose.yml up -d caddy
docker compose -f /root/ai-assistant/docker-compose.yml logs --tail=80 caddy
curl -fsS https://order.mrhellko.ru/health
curl -I https://g.order.mrhellko.ru/
```

## Защита VPS

Для gravity-sim production-режимом является статическая раздача. Если когда-либо появится отдельный контейнер, он должен иметь ограничения:

```yaml
cpus: 0.25
mem_limit: 128m
pids_limit: 64
```

Серверные расчеты физики запрещены.
