# Sentinel

Self-hosted, open Playwright end-to-end testing platform. Author, run, schedule, and analyse browser tests for your web product.

Think of it as a self-hosted alternative to Currents / Checkly / Ghost Inspector.

## Quick start (< 5 minutes)

### Prerequisites

- Node 22 LTS
- pnpm 9+
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <this-repo> sentinel
cd sentinel
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local — at minimum, set SENTINEL_ENCRYPTION_KEY, AUTH_SECRET, RUNNER_TOKEN:
openssl rand -base64 32   # run twice for the two secrets
```

### 3. Start infrastructure

```bash
# Postgres, Redis, MinIO, Mailpit
docker compose -f infra/compose/docker-compose.yml up -d postgres redis minio mailpit
```

### 4. Run database migrations and seed

```bash
pnpm db:migrate   # creates tables
pnpm db:seed      # seeds demo data
```

Demo credentials: `demo@sentinel.local` / `demo1234`

### 5. Start the apps

```bash
pnpm dev
```

- **Web**: http://localhost:3000
- **API**: http://localhost:3001
- **API docs**: http://localhost:3001/docs
- **MinIO console**: http://localhost:9001
- **Mailpit (email)**: http://localhost:8025

---

## Sizing guidance

One 2 vCPU / 4 GB runner ≈ 2 concurrent Chromium workers. Under-provision here and you'll see flaky tests that are actually infrastructure timeouts. For a small team (10–50 tests, < 4 concurrent runs): 2 vCPU / 4 GB is a reasonable starting point. Scale horizontally by adding more runner replicas.

## Security

Sentinel runs arbitrary user-supplied JavaScript with a full browser. Every test is treated as potentially hostile input. Read `docs/security.md` before deploying to a shared environment.

Key safeguards:
- Each test runs in an ephemeral Docker container with no network route to your platform's own services
- Secrets are AES-256-GCM encrypted at rest; never returned to the browser
- Static analysis blocks `child_process`, `worker_threads`, `vm`, `net`, and raw `process.env` access at save time
- Full audit log on all security-relevant actions

## Architecture

```
Browser (Next.js) → API (Fastify) → Queue (BullMQ/Redis) → Runner → Ephemeral Docker container
                                  → DB (PostgreSQL)
                                  → Artifacts (S3/MinIO)
```

See `docs/architecture.md` for the full diagram and rationale.

## Phases

| Phase | Status | Contents |
|---|---|---|
| 0 — Foundation | ✅ Done | Monorepo, DB schema, Docker Compose, API skeleton, web skeleton |
| 1 — Auth + first run | 🔜 Next | Auth, RBAC, Monaco editor, Docker sandbox, live logs |
| 2 — Artifacts & history | 🔜 | Screenshots, video, traces, flake scoring |
| 3 — Scheduling & CLI | 🔜 | Cron schedules, notifications, `sentinel` CLI |
| 4 — No-code builder | 🔜 | Drag-and-drop step builder, IR compiler |
| 5 — AI authoring | 🔜 | Generate tests from prompts, failure triage |
| 6 — Scale & polish | 🔜 | Sharding, autoscaling, visual regression, Helm |

## Development

```bash
pnpm dev          # all apps in watch mode
pnpm typecheck    # TypeScript across the monorepo
pnpm lint         # ESLint + format check
pnpm test         # unit + integration tests
pnpm db:studio    # Prisma Studio at http://localhost:5555
```

## License

MIT
