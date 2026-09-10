FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/runner/package.json ./apps/runner/
RUN pnpm install --frozen-lockfile

FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["node", "--import", "tsx/esm", "apps/runner/src/worker.ts"]

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @sentinel/shared run build
RUN pnpm --filter @sentinel/db run db:generate
RUN pnpm --filter @sentinel/runner run build

FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Runner needs docker CLI to launch sandbox containers
RUN apk add --no-cache docker-cli
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
# Runner must be in the docker group to call the daemon
RUN addgroup sentinel docker || true
COPY --from=builder --chown=sentinel:sentinel /app/apps/runner/dist ./dist
COPY --from=builder --chown=sentinel:sentinel /app/node_modules ./node_modules
EXPOSE 3002
CMD ["node", "dist/worker.js"]
