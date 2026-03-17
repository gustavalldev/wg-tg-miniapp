# VPN Backend

Минимальный внешний backend для `vpn-api` в режиме `remote-http`.

## Endpoints

- `GET /health`
- `POST /provision`
- `POST /revoke`

## Env

- `VPN_BACKEND_PORT`
- `VPN_BACKEND_PROTOCOL`
- `VPN_BACKEND_PROFILE_FORMAT`
- `VPN_BACKEND_NODES_JSON`

## Purpose

Этот сервис нужен как отдельный слой оркестрации, чтобы `vpn-api` не создавал профиль сам, а получал его от внешнего backend по HTTP.

Сейчас backend отдаёт прямой `VLESS`-профиль для одной foreign-ноды и служит временным provisioning-слоем до интеграции с реальным `Xray`.
