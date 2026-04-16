# ============================================================
# Konomi Web — Multi-stage Docker build
# ============================================================
# Stage 1: builder  — install deps, compile native addons,
#                      generate Prisma client, build web SPA
# Stage 2: runtime  — slim image with only production deps
# ============================================================

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-bookworm AS builder

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Native addon build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    libpng-dev libwebp-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# 1) Copy dependency manifests first (layer cache)
COPY package.json bun.lock ./
COPY konomi-core/package.json konomi-core/
COPY konomi-server/package.json konomi-server/
COPY konomi-web/package.json konomi-web/
# App workspace listed in root workspaces — need a stub so bun resolves it
COPY konomi-app/package.json konomi-app/

RUN npm install -g node-gyp && bun install --frozen-lockfile

# 2) Copy source
COPY . .

# 3) Build native addons (konomi-image + webp-alpha)
ENV LIBPNG_ROOT=/usr
ENV LIBWEBP_ROOT=/usr
RUN node scripts/build-native.mjs

# 4) Generate Prisma client (MySQL/MariaDB)
RUN bun run db:generate:server

# 5) Build web frontend (Vite SPA)
RUN bun run build:web

# 6) Production-only node_modules
RUN rm -rf node_modules && bun install --frozen-lockfile --production --ignore-scripts

# ── Stage 2: Runtime ────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache \
    libpng libwebp \
    gosu tini

# Install bun
RUN apk add --no-cache bash curl && \
    curl -fsSL https://bun.sh/install | bash && \
    apk del bash curl
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /build/package.json /build/bun.lock ./
COPY --from=builder /build/konomi-core/ ./konomi-core/
COPY --from=builder /build/konomi-server/ ./konomi-server/
COPY --from=builder /build/out/web/ ./konomi-web/dist/
COPY --from=builder /build/konomi-web/package.json ./konomi-web/
COPY --from=builder /build/konomi-app/package.json ./konomi-app/
COPY --from=builder /build/konomi-native/prebuilds/ ./konomi-native/prebuilds/
COPY --from=builder /build/generated/ ./generated/
COPY --from=builder /build/node_modules/ ./node_modules/
COPY --from=builder /build/prisma/ ./prisma/

# Entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default environment
ENV KONOMI_PORT=3000
ENV KONOMI_HOST=0.0.0.0
ENV KONOMI_DATA_ROOT=/images
ENV KONOMI_USER_DATA=/config
ENV DATABASE_URL=mysql://konomi:konomi@db:3306/konomi
ENV PUID=1000
ENV PGID=1000
ENV TZ=Asia/Seoul

# Create default data root
RUN mkdir -p /images /config

EXPOSE 3000

VOLUME ["/images", "/config"]

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD ["bun", "konomi-server/index.ts"]
