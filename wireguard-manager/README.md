# WireGuard Manager

Простой менеджер для управления WireGuard VPN через API.

## Структура проекта

```
wireguard-manager/
├── scripts/
│   └── wg-manager.sh      # Bash-скрипт для управления WireGuard
├── api/
│   ├── server.js          # HTTP API сервер
│   └── package.json       # Зависимости Node.js
├── config/                # Конфигурационные файлы
└── README.md
```

## Установка

### 1. Установите зависимости

```bash
# В папке api
cd api
npm install
```

### 2. Настройте WireGuard

Убедитесь, что WireGuard установлен и настроен на сервере:

```bash
# Установка WireGuard (Ubuntu/Debian)
sudo apt update
sudo apt install wireguard

# Создание ключей сервера
wg genkey | sudo tee /etc/wireguard/private.key
sudo cat /etc/wireguard/private.key | wg pubkey | sudo tee /etc/wireguard/public.key
```

### 3. Создайте базовый конфиг WireGuard

```bash
sudo nano /etc/wireguard/wg0.conf
```

```ini
[Interface]
PrivateKey = <ваш_приватный_ключ_сервера>
Address = 10.8.0.1/24
ListenPort = 51820
SaveConfig = true

# Включаем IP forwarding
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
```

### 4. Запустите WireGuard

```bash
sudo wg-quick up wg0
```

### 5. Сделайте скрипт исполняемым

```bash
chmod +x scripts/wg-manager.sh
```

## Использование

### Запуск API сервера

```bash
cd api
npm start
```

API будет доступен на `http://localhost:3000`

### API Endpoints

#### Создание peer
```bash
POST /api/peers
Content-Type: application/json

{
  "name": "user123",
  "ip": "10.8.0.2"
}
```

#### Удаление peer
```bash
DELETE /api/peers/user123
```

#### Получение конфига
```bash
GET /api/peers/user123/config
```

#### Список всех peer'ов
```bash
GET /api/peers
```

#### Проверка здоровья
```bash
GET /health
```

## Интеграция с Telegram-ботом

Обновите ваш Telegram-бот для работы с новым API:

```javascript
const axios = require('axios');

// Создание peer
const createPeer = async (name, ip) => {
  const response = await axios.post('http://localhost:3000/api/peers', {
    name,
    ip
  });
  return response.data.config;
};

// Удаление peer
const removePeer = async (name) => {
  await axios.delete(`http://localhost:3000/api/peers/${name}`);
};
```

## Безопасность

- API работает только локально (localhost)
- Для продакшена добавьте аутентификацию
- Используйте HTTPS в продакшене
- Ограничьте доступ к скриптам

## Требования

- Linux сервер
- WireGuard
- Node.js 14+
- Bash
- jq (для парсинга JSON) 