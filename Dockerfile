FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
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
RUN pnpm --filter @codeprism/engine build
# Build dashboard (Vite → dist/)
RUN pnpm --filter @codeprism/dashboard build

FROM base AS runtime
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/
# Dashboard static assets served by Fastify
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV CODEPRISM_PORT=4000
ENV CODEPRISM_DB_PATH=/data/codeprism.db

# Model configuration for Linux/Docker (no macOS ONNX constraints)
# Embedding: mxbai-embed-large-v1 (1024-d, MTEB ~64.5 vs nomic's ~62.4)
ENV CODEPRISM_EMBEDDING_MODEL=mixedbread-ai/mxbai-embed-large-v1
ENV CODEPRISM_EMBEDDING_DIM=1024
# Reranker: bge-reranker-v2-m3 (best cross-encoder quality, Linux-only — crashes macOS ONNX)
ENV CODEPRISM_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
# Persist model weights in /data so they survive container restarts
ENV CODEPRISM_MODELS_PATH=/data/models

VOLUME /data
EXPOSE 4000

CMD ["node", "packages/engine/dist/index.js"]
