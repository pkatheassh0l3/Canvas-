# Canvas++ — imagen para el NAS: servidor de sync + cliente web
FROM node:22-alpine AS web
WORKDIR /src/app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY app/package*.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production PORT=8787 CANVAS_DATA=/data
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/*.js ./
COPY --from=web /src/app/dist ./public
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "index.js"]
