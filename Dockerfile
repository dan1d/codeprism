FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/engine/package.json ./packages/engine/
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY . .
RUN pnpm --filter @srcmap/engine build

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/
COPY --from=build /app/packages/dashboard ./packages/dashboard
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV SRCMAP_PORT=4000
ENV SRCMAP_DB_PATH=/data/srcmap.db
VOLUME /data
EXPOSE 4000

CMD ["node", "packages/engine/dist/index.js"]
