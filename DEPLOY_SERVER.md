# Control Server Deploy

## Current Server Constraints

- `80` and `443` are already occupied by other products
- `3001` and `3012` are already occupied
- `5433`, `5434`, `5435` are already occupied
- safe ports found during check: `3110`, `3112`, `3020`

## Files For Server Deploy

- `docker-compose.yml`
- `docker-compose.server.yml`
- `.env.server.example`

## Deploy Layout

Use deploy directory:

```bash
~/deploy/vpnbot
```

## Recommended Commands

```bash
mkdir -p ~/deploy/vpnbot
cd ~/deploy/vpnbot
```

Copy project there, then create `.env` from `.env.server.example` and fill:

- `TELEGRAM_TOKEN`
- `WEBAPP_URL`
- `VITE_API_BASE` (`https://vpn.ordbox.ru`, без суффикса `/api`)
- postgres passwords
- real `SERVERS_JSON`
- real `VPN_BACKEND_NODES_JSON`

## Start Command

Use:

```bash
docker-compose -f docker-compose.yml -f docker-compose.server.yml up --build -d
```

## Expected Exposed Ports

- `3110` -> `vpn-api`
- `3112` -> `mini-app`

`vpn-backend` and `postgres` stay internal.

## Architecture

- control server hosts `telegram-bot`, `mini-app`, `vpn-api`, `vpn-backend`
- client connects directly to one foreign `VLESS` node
- no `RU entry -> foreign exit` route in this deploy mode
