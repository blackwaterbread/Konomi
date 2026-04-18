# Building Konomi

Konomi ships in two shapes from the same codebase:

- **Desktop app** (Electron) — SQLite, packaged with electron-builder
- **Web server** (Fastify + static web client) — MariaDB, deployed via Docker

Pick the path that matches what you're building.

---

## 1. Clone & Install

```bash
git clone https://github.com/blackwaterbread/Konomi.git
cd Konomi
bun install
```

Common prerequisites:

| Tool | Notes |
|------|-------|
| [Node.js](https://nodejs.org/) 22+ | |
| [Bun](https://bun.sh/) | package manager + script runner |

Native addon build toolchain is only required when no prebuilt binary
matches your platform. See [PREBUILD.md](PREBUILD.md).

---

## 2. Native Addons

Prebuilt binaries for `win32-x64`, `darwin-x64`, `darwin-arm64` are
committed to [`prebuilds/`](prebuilds/). If your platform is covered, skip
this step.

Otherwise build them from source — see [PREBUILD.md](PREBUILD.md).

---

## 3. Desktop (Electron)

### 3.1 Database (SQLite)

```bash
bun run db:generate   # Generate Prisma client (SQLite)
bun run db:migrate    # Run migrations (app must be closed — SQLite locks)
```

Migrations live in [`prisma/migrations/sqlite/`](prisma/migrations/sqlite/).
Schema: [`prisma/schema/sqlite.prisma`](prisma/schema/sqlite.prisma).

### 3.2 Run in development

```bash
bun run dev
```

Launches Electron + Vite with HMR.

### 3.3 Build installers

```bash
bun run build:win    # Windows installer (NSIS)
bun run build:mac    # macOS app
bun run build:linux  # Linux AppImage / deb
```

electron-builder config: [`src/app/electron-builder.yml`](src/app/electron-builder.yml).

> Run `bun run db:migrate` before building if the schema has changed.

---

## 4. Web Server (Fastify + MariaDB)

The server reuses `@konomi/core` business logic and speaks MariaDB through
Prisma's MySQL adapter.

### 4.1 Prerequisites

- MariaDB 10.11+ (or MySQL 8+), reachable via `DATABASE_URL`
- For Docker deploys, Docker is all you need — MariaDB is bundled

### 4.2 Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KONOMI_PORT` | `3000` | Listen port |
| `KONOMI_HOST` | `0.0.0.0` | Listen host |
| `DATABASE_URL` | `mysql://root:mariadb@127.0.0.1:3306/konomi` | MariaDB DSN |
| `KONOMI_DATA_ROOT` | `/images` | Root for image folders (Docker volume mount point) |
| `KONOMI_USER_DATA` | `<repoRoot>/database` | Writable data dir |

### 4.3 Database (MariaDB)

```bash
bun run db:generate:server   # Generate Prisma client (MariaDB)
bun run db:push:server       # Push schema (development)
bun run db:migrate:server    # Create + apply migrations
```

Schema: [`prisma/schema/mariadb.prisma`](prisma/schema/mariadb.prisma).

### 4.4 Development

Run server and web client together:

```bash
bun run dev:web:all
```

Or separately:

```bash
bun run dev:server   # Fastify on KONOMI_PORT (default 3000)
bun run dev:web      # Vite dev server for src/web
```

### 4.5 Production build

```bash
bun run build:web    # Build static web client → out/web
bun src/server/index.ts
```

The server serves the built web client at `/` and the API at `/api/*`.

---

## 5. Docker

All-in-one image that bundles the server, web client, native addons, and a
minimal MariaDB — see [`Dockerfile`](Dockerfile).

```bash
bun run docker:build   # docker build -t konomi:latest .
bun run docker:up      # docker compose up -d
bun run docker:down    # docker compose down
```

Mount host image directories at `/images/<name>` in
[`docker-compose.yml`](docker-compose.yml). Each first-level subdirectory
becomes a selectable folder in the UI; see [`src/server/lib/data-root.ts`](src/server/lib/data-root.ts)
for the scan rules.

---

## Project Structure

```
src/core/              Platform-agnostic business logic (@konomi/core)
src/app/               Electron desktop app (main, preload, renderer)
src/web/               Web client (React UI shared via @konomi/web)
src/server/            Fastify web backend
src/native/            C++ native addon sources
prebuilds/             Prebuilt native binaries (per platform-arch)
prisma/                Prisma schemas + migrations (sqlite + mariadb)
docker/                Docker entrypoint + init scripts
scripts/               Build and utility scripts
tests/                 Vitest suites (backend + frontend)
```

---

## Key Commands

```bash
# Desktop
bun run dev                  # Electron dev (HMR)
bun run build                # Typecheck + electron-vite build
bun run build:{win,mac,linux}
bun run db:migrate           # SQLite migrations

# Web / Server
bun run dev:web:all          # Fastify + Vite dev client
bun run build:web            # Build static web client
bun run db:migrate:server    # MariaDB migrations

# Docker
bun run docker:{build,up,down}

# Native
bun run prebuild:native      # Rebuild native addons (see PREBUILD.md)

# Quality
bun run typecheck            # Run typechecks (node + web)
bun run lint                 # ESLint
bun run test:backend         # Vitest backend suite
bun run test:frontend        # Vitest frontend suite
```
