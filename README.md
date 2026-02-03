# VPN Guard Mini App

🚀 **Telegram бот + Mini App для управления WireGuard VPN**

Полноценная система управления VPN‑доступом через Telegram Bot и Mini App.

## 📋 Содержание

- [Возможности](#-возможности)
- [Архитектура](#-архитектура)
- [Быстрый старт](#-быстрый-старт)
- [Настройка](#-настройка)
- [Использование](#-использование)
- [Деплой](#-деплой)
- [Разработка](#-разработка)

## ✨ Возможности

### 🤖 Telegram Bot
- Вход в Mini App
- Проверка подписки на канал
- Поддержка

### 📱 Telegram Mini App (React)
- Управление VPN профилем
- Выбор сервера (основной)
- Создание peer и скачивание конфига
- Управление подключениями
- Админка (пользователи, пиры, рассылка)

### 🔧 API
- REST API для управления WireGuard
- Bash скрипты для работы с конфигурациями
- Автоматическая генерация ключей

## 🏗️ Архитектура

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Telegram Bot   │    │ Telegram Mini App│    │  WireGuard API  │
│                 │    │                  │    │                 │
│  - /start       │    │  - UI            │    │  - /api/peers   │
│  - /help        │    │  - VPN actions   │    │  - /health      │
│  - WebApp Btn   │    │  - Admin tools   │    │  - Bash Scripts │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  WireGuard      │
                    │  Server         │
                    │                 │
                    │  - wg0          │
                    │  - Peer Configs │
                    │  - VPN Tunnel   │
                    └─────────────────┘
```

## 🚀 Быстрый старт

### Требования
- Docker и Docker Compose
- Telegram Bot Token
- WireGuard сервер (для продакшена)

### Локальный запуск (демо)

1. **Клонируйте репозиторий:**
```bash
git clone https://github.com/your-username/vpn-bot.git
cd vpn-bot
```

2. **Создайте файл .env:**
```bash
# Telegram Bot
TELEGRAM_TOKEN=your_bot_token_here

# Mini App
WEBAPP_URL=http://localhost:3012
CHANNEL_USERNAME=@kirillprodev
ADMIN_USERNAMES=kirillprodev
```

3. **Запустите через Docker:**
```bash
docker-compose up --build
```

## ⚙️ Настройка

### Telegram Bot

1. **Создайте бота через @BotFather:**
   - Напишите `/newbot`
   - Выберите имя и username
   - Получите токен

2. **Добавьте токен в .env:**
```bash
TELEGRAM_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

### Telegram Mini App

Для разработки локально нужен HTTPS‑туннель (например, `ngrok` или `cloudflared`), чтобы Telegram мог открыть Mini App.

### WireGuard API

API автоматически настраивается при запуске контейнеров.

**Доступные эндпоинты:**
- `GET /health` - проверка статуса
- `GET /api/peers` - список peer'ов
- `POST /api/peers` - создание peer'а
- `DELETE /api/peers/:name` - удаление peer'а
- `GET /api/peers/:name/config` - конфигурация peer'а

## 📱 Использование

### Telegram Bot

**Команды:**
- `/start` - открыть Mini App
- `/help` - поддержка

### Telegram Mini App

**Функции:**
- Просмотр статуса аккаунта
- Создание VPN и скачивание конфига
- Управление подключениями

## 🌐 Деплой

### На одном сервере

1. **Подготовьте сервер:**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io docker-compose git

# Настройте WireGuard
sudo apt install wireguard
```

2. **Клонируйте проект:**
```bash
git clone https://github.com/your-username/vpn-bot.git
cd vpn-bot
```

3. **Настройте переменные:**
```bash
cp .env.example .env
# Отредактируйте .env с вашими данными
```

4. **Запустите:**
```bash
docker-compose up -d
```

### Разделение на серверы

**VPN Server:**
- Только WireGuard
- Порт 51820/UDP
- Публичный IP

**Control Server:**
- Telegram Bot
- Mini App
- API
- Порт 3010, 3012

## 🛠️ Разработка

### Структура проекта

```
vpn_bot/
├── bot/                    # Telegram бот
│   ├── bot.js
│   ├── package.json
│   └── Dockerfile
├── mini-app/              # Telegram Mini App (React + Express)
│   ├── client/
│   ├── package.json
│   └── Dockerfile
├── wireguard-manager/     # API и скрипты
│   ├── api/
│   ├── scripts/
│   └── README.md
├── docker-compose.yml     # Оркестрация
├── .env.example          # Пример переменных
└── README.md             # Документация
```

### Локальная разработка

1. **Установите зависимости:**
```bash
# Bot
cd bot && npm install

 # Mini App
cd mini-app/client && npm install

# API
cd wireguard-manager/api && npm install
```

2. **Запустите компоненты:**
```bash
# Bot
cd bot && npm start

# Mini App (React dev server)
cd mini-app/client && npm run dev

# Mini App (Express, отдаёт build)
cd mini-app && npm install && npm run build && npm start

# API
cd wireguard-manager/api && npm start
```

### Переменные окружения

**Обязательные:**
- `TELEGRAM_TOKEN` - токен Telegram бота

**Опциональные:**
- `ADMIN_USERNAMES` - список админов для мини‑аппа (через запятую, без @)
- `SERVERS_JSON` - JSON массив серверов для списка (если не указан, берётся один SERVER_IP)

### Переменные окружения мини‑аппа (React)
- `VITE_API_BASE` - URL API (по умолчанию: http://localhost:3010)
- `VITE_CHANNEL_USERNAME` - канал для подписки (по умолчанию: @kirillprodev)

## 🔒 Безопасность

### Рекомендации

1. **Измените пароли по умолчанию**
2. **Используйте HTTPS в продакшене**
3. **Настройте файрвол**
4. **Регулярно обновляйте зависимости**
5. **Мониторьте логи**

### Переменные для продакшена

```bash
# Обязательно измените в продакшене
TELEGRAM_TOKEN=your_real_bot_token

# Дополнительно
NODE_ENV=production
```

## 🤝 Вклад в проект

1. Fork репозитория
2. Создайте ветку для фичи
3. Внесите изменения
4. Создайте Pull Request

## 📄 Лицензия

MIT License - см. файл [LICENSE](LICENSE)

## 🆘 Поддержка

- **Issues:** [GitHub Issues](https://github.com/your-username/vpn-bot/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-username/vpn-bot/discussions)

---

⭐ **Если проект вам понравился, поставьте звезду!** 
