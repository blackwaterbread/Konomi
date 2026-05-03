# ============================================================
# Konomi Web — Multi-stage Docker build (all-in-one)
# ============================================================

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-bookworm AS builder

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    libpng-dev libwebp-dev zlib1g-dev libturbojpeg0-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json bun.lock ./
COPY src/core/package.json src/core/
COPY src/server/package.json src/server/
COPY src/web/package.json src/web/
COPY src/app/package.json src/app/

RUN npm install -g node-gyp && bun install --frozen-lockfile

COPY . .

# Build native addons
ENV LIBPNG_ROOT=/usr
ENV LIBWEBP_ROOT=/usr
ENV LIBJPEG_ROOT=/usr
RUN node scripts/build-native.mjs

# Generate Prisma clients
# - server: MariaDB client used at runtime via setDBProvider
# - sqlite: required because src/core/lib/db.ts statically imports the
#   SQLite-generated PrismaClient as a value (the SQLite branch never
#   runs in the server, but the import must still resolve at load time)
RUN bun run db:generate:server && bun run db:generate

# Build web frontend
RUN bun run build:web

# Production deps + aggressive pruning
RUN rm -rf node_modules && bun install --frozen-lockfile --production --ignore-scripts \
  # ── Prisma: mysql WASM only ──
  && rm -rf node_modules/prisma \
            node_modules/@prisma/engines \
            node_modules/@prisma/studio-core \
            node_modules/@prisma/fetch-engine \
            node_modules/@prisma/dev \
            node_modules/@prisma/get-platform \
            node_modules/@prisma/adapter-better-sqlite3 \
  && find node_modules/@prisma/client/runtime -name "*.map" -delete \
  && find node_modules/@prisma/client/runtime -name "*sqlserver*" -delete \
  && find node_modules/@prisma/client/runtime -name "*postgresql*" -delete \
  && find node_modules/@prisma/client/runtime -name "*cockroachdb*" -delete \
  && find node_modules/@prisma/client/runtime -name "*sqlite*" -delete \
  && find node_modules/@prisma/client/runtime -name "*wasm-compiler*" -delete \
  && find node_modules/@prisma/client/runtime -name "*index-browser*" -delete \
  && rm -rf node_modules/@prisma/client/generator-build \
  # ── Remove packages not needed at runtime ──
  && rm -rf node_modules/typescript \
            node_modules/better-sqlite3 \
            node_modules/effect \
            node_modules/@electric-sql \
            node_modules/fast-check \
            node_modules/chevrotain \
            node_modules/hono \
            node_modules/remeda \
            node_modules/lodash \
            node_modules/@types \
            node_modules/valibot \
            node_modules/jiti \
            node_modules/sharp \
            node_modules/@img \
  # ── Strip junk from all remaining modules ──
  && find node_modules -name "*.d.ts" -delete \
  && find node_modules -name "*.d.mts" -delete \
  && find node_modules -name "*.map" -delete \
  && find node_modules \( -name "README*" -o -name "CHANGELOG*" -o -name "LICENSE*" \) -delete \
  && find node_modules \( -name "test" -o -name "tests" -o -name "docs" -o -name ".github" \) -type d -exec rm -rf {} + 2>/dev/null \
  ; \
  # ── Stubs for packages imported by core but unused at runtime ──
  mkdir -p node_modules/better-sqlite3 && \
  printf '{"name":"better-sqlite3","main":"index.js"}' > node_modules/better-sqlite3/package.json && \
  printf 'module.exports=function(){throw new Error("stub")}' > node_modules/better-sqlite3/index.js && \
  mkdir -p node_modules/@prisma/adapter-better-sqlite3 && \
  printf '{"name":"@prisma/adapter-better-sqlite3","main":"index.js"}' > node_modules/@prisma/adapter-better-sqlite3/package.json && \
  printf 'module.exports.PrismaBetterSqlite3=function(){throw new Error("stub")}' > node_modules/@prisma/adapter-better-sqlite3/index.js && \
  echo "Pruning complete"

# ── Stage 2: Extract minimal MariaDB from Alpine ───────────
FROM alpine:3.22 AS mariadb-extract

RUN apk add --no-cache mariadb mariadb-client

# ── Stage 3: Runtime ────────────────────────────────────────
FROM oven/bun:1-alpine AS runtime

# Minimal runtime libs (no full MariaDB apk)
RUN apk add --no-cache libpng libwebp libjpeg-turbo gosu tini \
    # Shared libs needed by MariaDB binaries
    libaio ncurses-libs pcre2 zstd-libs

# Cherry-pick only essential MariaDB files (~47MB instead of ~210MB)
COPY --from=mariadb-extract /usr/bin/mariadbd /usr/bin/
COPY --from=mariadb-extract /usr/bin/mariadb /usr/bin/
COPY --from=mariadb-extract /usr/bin/mariadb-admin /usr/bin/
COPY --from=mariadb-extract /usr/bin/mariadb-install-db /usr/bin/
COPY --from=mariadb-extract /usr/bin/mariadbd-safe /usr/bin/
COPY --from=mariadb-extract /usr/bin/my_print_defaults /usr/bin/
COPY --from=mariadb-extract /usr/bin/resolveip /usr/bin/
COPY --from=mariadb-extract /usr/bin/aria_chk /usr/bin/
COPY --from=mariadb-extract /usr/share/mariadb/ /usr/share/mariadb/
COPY --from=mariadb-extract /usr/lib/mariadb/ /usr/lib/mariadb/
# mysql symlinks used by mariadb-install-db
RUN ln -sf mariadbd /usr/bin/mysqld && \
    ln -sf mariadb-install-db /usr/bin/mysql_install_db && \
    ln -sf mariadb-admin /usr/bin/mysqladmin && \
    ln -sf mariadb /usr/bin/mysql && \
    # mysql user needed by MariaDB
    addgroup -S mysql && adduser -S -G mysql -H -D mysql

WORKDIR /app

COPY --from=builder /build/package.json ./
COPY --from=builder /build/src/core/ ./src/core/
COPY --from=builder /build/src/server/ ./src/server/
COPY --from=builder /build/out/web/ ./src/web/dist/
COPY --from=builder /build/src/web/package.json ./src/web/
COPY --from=builder /build/src/app/package.json ./src/app/
COPY --from=builder /build/prebuilds/ ./prebuilds/
COPY --from=builder /build/generated/ ./generated/
COPY --from=builder /build/node_modules/ ./node_modules/
COPY --from=builder /build/prisma/ ./prisma/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV KONOMI_PORT=3000
ENV KONOMI_HOST=0.0.0.0
ENV KONOMI_DATA_ROOT=/images
ENV KONOMI_USER_DATA=/config
ENV DATABASE_URL=mysql://konomi:konomi@127.0.0.1:3306/konomi
ENV PUID=911
ENV PGID=911
ENV TZ=Asia/Seoul

RUN mkdir -p /images /config

EXPOSE 3000
VOLUME ["/images", "/config"]

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD ["bun", "src/server/index.ts"]
