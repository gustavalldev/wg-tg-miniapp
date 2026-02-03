FROM node:18-alpine AS builder
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client ./client
RUN cd client && npm run build

FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js ./
COPY --from=builder /app/client/dist ./client/dist
EXPOSE 3002
CMD ["npm", "start"]
