FROM node:18-alpine AS builder
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client ./client
ARG VITE_API_BASE
ARG VITE_CHANNEL_USERNAME
ARG VITE_ALLOW_STANDALONE
ARG VITE_PERSONAL_ADMIN_MODE
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_CHANNEL_USERNAME=$VITE_CHANNEL_USERNAME
ENV VITE_ALLOW_STANDALONE=$VITE_ALLOW_STANDALONE
ENV VITE_PERSONAL_ADMIN_MODE=$VITE_PERSONAL_ADMIN_MODE
RUN cd client && npm run build

FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js ./
COPY legal-pages.js ./
COPY --from=builder /app/client/dist ./client/dist
EXPOSE 3002
CMD ["npm", "start"]
