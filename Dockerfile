FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/dashboard/package.json ./packages/dashboard/
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules
COPY . .
# Build engine (TypeScript → dist/)
RUN pnpm --filter @srcmap/engine build
# Build dashboard (Vite → dist/)
RUN pnpm --filter @srcmap/dashboard build

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/
# Dashboard static assets served by Fastify
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV SRCMAP_PORT=4000
ENV SRCMAP_DB_PATH=/data/srcmap.db
VOLUME /data
EXPOSE 4000

CMD ["node", "packages/engine/dist/index.js"]
