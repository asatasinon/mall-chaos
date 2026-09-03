ARG BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/
FROM ${BASE_IMAGE_REGISTRY}node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# ── Dependencies ─────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Build ────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Production ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

RUN mkdir -p ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/src/worker ./src/worker
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder --chown=nextjs:nodejs /app/src/content/runbook ./src/content/runbook
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3086

# Default: web mode. Override CMD for worker mode.
ENV PORT=3086
CMD ["node", "server.js"]
