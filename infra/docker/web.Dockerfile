FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["pnpm", "--filter", "@sentinel/web", "run", "dev"]

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @sentinel/shared run build
RUN pnpm --filter @sentinel/ui run build
RUN pnpm --filter @sentinel/web run build

FROM node:22-alpine AS production
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
WORKDIR /app
COPY --from=builder --chown=sentinel:sentinel /app/apps/web/.next/standalone ./
COPY --from=builder --chown=sentinel:sentinel /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=sentinel:sentinel /app/apps/web/public ./apps/web/public
USER sentinel
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
