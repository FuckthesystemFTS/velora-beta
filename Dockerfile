FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY scripts ./scripts
COPY releases ./releases
COPY docs ./docs
COPY schemas ./schemas
COPY examples ./examples
COPY VELORA_GUIDA_PUBBLICAZIONE.html ./VELORA_GUIDA_PUBBLICAZIONE.html
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @velora/shared build && pnpm --filter @velora/api build
ENV NODE_ENV=production
CMD ["pnpm", "start:api"]
