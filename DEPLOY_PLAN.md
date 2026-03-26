# Deploy Status

## Current Topology

- `vpnbot` на control server отвечает за bot, mini app, `vpn-api` и PostgreSQL.
- Клиент получает direct `VLESS`-профиль и подключается сразу к foreign node.
- Российский entry hop в текущей схеме не используется.
- Боевой data plane:
  - host: `vpnserv1.ordbox.ru`
  - ip: `176.98.191.110`
  - transport: `VLESS + TLS`
  - port: `443`

## Current State

- DNS для `vpnserv1.ordbox.ru` смотрит на `176.98.191.110`.
- На foreign node выпущен и применён Let's Encrypt сертификат.
- `Xray` поднят на foreign node и слушает `443/tcp`.
- На foreign node работает repo-based `provisioner` с `GET /health`, `POST /provision`, `POST /revoke`.
- `vpnbot` на control server переведён на `VPN_PROVIDER_MODE=remote-http`.
- `vpn-api` на control server смотрит на foreign provisioner, а не на локальную заглушку.
- В PostgreSQL актуальный `foreign-vless-main` обновлён на `vpnserv1.ordbox.ru`.

## Verified

- `docker compose -f docker-compose.server.yml ps` на control server: все сервисы `Up`.
- `GET /api/diagnostics` на control server возвращает `foreign-vless-main` с `vpnserv1.ordbox.ru`.
- `GET /health` на foreign provisioner отвечает успешно.
- Прямой live smoke test `provision -> revoke` на foreign provisioner прошёл:
  - клиент добавлялся в live `Xray` config
  - клиент удалялся обратно
- Полный e2e через `vpn-api` прошёл:
  - `POST /api/webapp/connect` вернул рабочий `vless://...@vpnserv1.ordbox.ru:443`
  - профиль реально появился на foreign node
  - `POST /api/webapp/remove` удалил профиль
  - в `peers` после удаления `COUNT(*) = 0`

## Repos And Commits

- `vpnbot`
  - `8dd6ccb` `fix: pass dev webapp env to vpn api`
  - `dd8a491` `feat: update app copy for access profiles`
  - `b9e1335` `fix: align control deploy with direct vless flow`
- `vpn-infra`
  - `d7e547d` `fix: write xray config in place for bind mounts`
  - `21957b2` `feat: add foreign xray provisioner stack`
  - `01af904` `feat: switch infra to direct vless node model`

## Server Roles

- control server:
  - repo: `/home/codex/deploy/vpnbot`
  - stack: bot, mini app, `vpn-api`, PostgreSQL
- foreign server:
  - repo: `~/deploy/vpn-infra`
  - runtime: `~/deploy/vpn-infra/runtime/foreign-vless-node`
  - stack: `Xray`, `provisioner`

## Remaining Hardening

- убрать локальный `vpn-backend` контейнер из control stack, если он больше не нужен как legacy fallback
- оформить нормальное обновление / ротацию Let's Encrypt сертификата
- добавить мониторинг и alerting для `Xray` и `provisioner`
- сделать backup / restore для PostgreSQL
- привести runtime schema migration к явным миграциям, а не только runtime `ensureSchema()`
- для регистрации новой ноды использовать `ops/register_direct_vless_node.sql.example`
