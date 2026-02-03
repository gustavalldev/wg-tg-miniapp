FROM node:18-alpine

WORKDIR /app

# Устанавливаем необходимые пакеты
RUN apk add --no-cache bash jq wireguard-tools

# Копируем package.json и устанавливаем зависимости
COPY api/package*.json ./
RUN npm install --only=production

# Копируем код приложения
COPY api/. .

COPY api/.env .env
# Копируем скрипты WireGuard
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "server.js"]