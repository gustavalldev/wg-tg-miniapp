FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --only=production

# Копируем код приложения
COPY . .

CMD ["node", "bot.js"] 