# VPN Manager

Этот модуль больше не управляет `wg0` и не вызывает `wg`. Теперь он хранит и отдаёт управляемые access profiles, которые можно привязать к любому внешнему VPN backend.

## Что делает сервис

- авторизует Telegram WebApp;
- проверяет подписку на канал;
- создаёт один профиль доступа на пользователя;
- хранит профиль в PostgreSQL;
- отдаёт профиль в виде JSON или URI через API.

## Структура

```bash
wireguard-manager/
├── api/
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
└── README.md
```

## Переменные окружения

- `PORT`
- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`
- `TELEGRAM_TOKEN`
- `CHANNEL_USERNAME`
- `SERVER_IP`
- `SERVERS_JSON`
- `VPN_PROTOCOL_LABEL`
- `VPN_PROFILE_FORMAT`
- `VPN_ACCESS_SCHEME`
- `VPN_ACCESS_PORT`
- `VPN_PROFILE_TEMPLATE_JSON`
- `VPN_PROVIDER_MODE`
- `VPN_BACKEND_URL`
- `VPN_BACKEND_TOKEN`
- `VPN_BACKEND_TIMEOUT_MS`

## Быстрый старт

```bash
cd wireguard-manager/api
npm install
npm start
```

## Основные endpoints

- `POST /api/webapp/auth`
- `POST /api/webapp/connect`
- `POST /api/webapp/remove`
- `POST /api/webapp/config`
- `POST /api/webapp/admin/*`
- `GET /api/servers`
- `GET /api/diagnostics`

## Следующий шаг

Сервис уже поддерживает 2 режима:

- `VPN_PROVIDER_MODE=local-template` - локальная генерация JSON/URI профиля
- `VPN_PROVIDER_MODE=remote-http` - вызов внешнего backend по `POST /provision` и `POST /revoke`

Для `remote-http` ожидается контракт:

```json
POST /provision
{
  "profile": { "name": "user-1", "id": "server-1-abcd", "token": "..." },
  "server": { "id": "server-1" },
  "user": { "id": 123456789, "username": "kirill" }
}
```

Ответ:

```json
{
  "protocol": "Managed VPN",
  "profile_format": "json",
  "access_uri": "vpn://...",
  "config_payload": {},
  "download_name": "user-1.json",
  "meta": {}
}
```
