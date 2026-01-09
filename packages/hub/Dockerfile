FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core ./packages/core
COPY packages/hub ./packages/hub
RUN bun install --frozen-lockfile
RUN bun run build:hub

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/packages/hub/dist ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "main.js"]
