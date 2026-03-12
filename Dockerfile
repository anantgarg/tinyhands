# Stage 1: Build TypeScript
FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Copy SQL migration files (tsc doesn't copy non-TS files)
RUN cp -r src/db/migrations dist/db/migrations

# Stage 2: Production runtime
FROM node:20-slim

RUN npm install -g pm2

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY ecosystem.config.js ./
COPY docker/ ./docker/

COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
