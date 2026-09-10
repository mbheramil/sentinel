# Sentinel — Build Progress

> Updated: 2026-09-09

## Phase Plan

| Phase | Title | Est. | Status |
|---|---|---|---|
| 0 | Foundation | 1 unit | ✅ Complete |
| 1 | Auth, projects, code tests, first run | 4 units | ✅ Complete |
| 2 | Artifacts, traces, history, flake | 3 units | ✅ Complete |
| 3 | Suites, schedules, notifications, API keys, CLI | 3 units | ✅ Complete |
| 4 | No-code builder | 4 units | ✅ Complete |
| 5 | AI authoring & triage | 2 units | ✅ Complete |
| 6 | Scale & polish | 3 units | ✅ Complete |

---

## Phase 0 — Foundation

### Done
- [x] Monorepo: pnpm workspaces + Turborepo, root `package.json` + `turbo.json`
- [x] TypeScript configs: base, node, nextjs in `packages/config`
- [x] ESLint flat config + Prettier config in `packages/config`
- [x] Tailwind preset with status tokens in `packages/config`
- [x] Full Prisma schema (`packages/db/prisma/schema.prisma`) covering all §5 models including §22 amendments (diagnostics, tasks, capture endpoints)
- [x] `packages/db/src/index.ts` — singleton Prisma client
- [x] Seed script (`prisma/seed.ts`) — demo org, owner + viewer, project, 2 environments, 5 tests (2 passing, 1 failing, 1 flaky/muted, 1 builder-mode), 1 suite, 1 disabled schedule, 3 historical runs
- [x] `packages/shared` — constants (PLAYWRIGHT_VERSION, prefixes, limits), Zod schemas (common, run, test, project, events)
- [x] Docker Compose: postgres 16, redis 7, minio (with init), mailpit, api/runner/web profiles for full stack
- [x] Fastify API skeleton: `config.ts` (Zod-validated, exits non-zero on missing vars), `logger.ts` (pino with redaction), `server.ts`, health routes (`/healthz`, `/readyz`, `/metrics`)
- [x] Next.js 15 skeleton: layout, home page, login stub, signup stub, Tailwind + design tokens, CSS variables for light+dark
- [x] GitHub Actions CI workflow: lint → typecheck → unit → integration → build → e2e
- [x] `.env.example` with safe local defaults
- [x] `.gitignore`

---

## Phase 1 — Auth, Projects, Code Tests, First Run

### Done
- [x] Auth.js v5 signup/login/logout with Prisma adapter + Argon2id passwords
- [x] Orgs + memberships + RBAC service (`authorize(actor, action, resource)`)
- [x] `hasMinRole(actor, minRole)` — role hierarchy: VIEWER < EDITOR < ADMIN < OWNER
- [x] Project CRUD (`apps/api/src/routes/v1/projects.ts`)
- [x] Environment CRUD with AES-256-GCM encrypted secrets (`apps/api/src/routes/v1/environments.ts`)
- [x] Test CRUD + versions + validate endpoint (`apps/api/src/routes/v1/tests.ts`)
- [x] Run creation API, BullMQ producer (`apps/api/src/queue/producer.ts`)
- [x] RunShard claim/heartbeat/complete internal routes (`apps/api/src/routes/internal/index.ts`)
- [x] NDJSON event pipeline + SSE live log via Redis pub/sub
- [x] Runner worker: claim → sandbox → custom reporter → events → complete
- [x] Docker sandbox strategy
- [x] Run list + run detail UI with per-test results
- [x] Cancel run endpoint + UI button
- [x] API keys: list, create, revoke (`apps/api/src/routes/v1/apiKeys.ts`)

---

## Phase 2 — Artifacts, Traces, History, Flake

### Done
- [x] Artifact pre-sign upload endpoint + Artifact create endpoint
- [x] Artifact download (presigned GET URL via S3)
- [x] Screenshot/Video/Trace viewers in the web UI
- [x] Attempt detail page with step timeline (`apps/web/components/step-timeline.tsx`)
- [x] Test history endpoint + chart (`/api/v1/tests/:id/history`)
- [x] Flake score computation (`apps/api/src/services/flakeScorer.ts`)
- [x] TestStat upsert triggered on shard completion
- [x] Project insights API: pass-rate trend, flaky tests, slowest tests
- [x] Insights page with charts
- [x] Retry run endpoint + UI
- [x] Retention reaper + stats reconciler background jobs (`apps/api/src/queue/reaper2.ts`)
- [x] Phase 2 routes registered in `server.ts`

---

## Phase 3 — Suites, Schedules, Notifications, CLI

### Done
- [x] Suite CRUD + items + reorder (`apps/api/src/routes/v1/phase3.ts`)
- [x] Schedule CRUD + BullMQ repeatable jobs + cron worker (`apps/api/src/services/scheduleSync.ts`)
- [x] Integration CRUD (Slack, Email, Webhook) with encrypted config
- [x] Notification queue + worker with dedup, backoff, auto-disable (`apps/api/src/services/notifications.ts`)
- [x] Capture endpoints + webhook receiver at `/hooks/c/:slug`
- [x] Task CRUD (seed/cleanup/custom) (`apps/api/src/routes/v1/phase3.ts`)
- [x] CLI: `sentinel login`, `sentinel run`, `sentinel status`, `sentinel cancel`, `sentinel push`, `sentinel pull`, `sentinel open`
- [x] JUnit reporter (`apps/cli/src/reporters/junit.ts`)
- [x] GitHub Action (`apps/cli/github-action/action.yml`)
- [x] Phase 3 routes + hookRoutes registered in `server.ts`

---

## Phase 4 — No-code Builder

### Done
- [x] Step IR schema in `packages/shared`
- [x] Builder routes: step CRUD, IR validation, code generation from IR (`apps/api/src/routes/v1/builderRoutes.ts`)
- [x] Monaco code editor integration in web UI
- [x] Builder canvas UI with drag-and-drop step ordering
- [x] Code ↔ builder round-trip (IR ↔ TypeScript codegen)
- [x] "Record" mode scaffolding (RECORDED authoring mode)

---

## Phase 5 — AI Authoring & Triage

### Done
- [x] AI routes: generate test from description, suggest fixes for failing attempt, explain step (`apps/api/src/routes/v1/aiRoutes.ts`)
- [x] Streaming response support for AI generation
- [x] AI triage panel in attempt detail page
- [x] "Generate with AI" flow in test editor
- [x] Token budget enforcement + prompt injection guards
- [x] Phase 5 routes registered in `server.ts`

---

## Phase 6 — Scale & Polish

### Done

#### Part A — Multi-runner shard aggregation
- [x] `apps/api/src/services/shardAggregator.ts` — extracted & enhanced from internal route
  - Checks all RunShard rows are terminal before finalizing
  - Computes `durationMs` as max-across-shards (latest finishedAt − startedAt)
  - Sums totals from all RunTest rows
  - Fires notifications via `fireNotifications()`
- [x] `PATCH /internal/shards/:id/complete` now calls `aggregateRunShards()` instead of inline rollup

#### Part B — Runner health / Admin page
- [x] `apps/api/src/routes/v1/adminRoutes.ts` — OWNER-only Fastify plugin
  - `GET /admin/overview`: runner health, BullMQ queue depths, stuck runs (RUNNING > 2h), DB stats
  - `POST /admin/runs/:id/force-fail`: force a stuck run to ERROR status
- [x] `apps/web/app/(app)/settings/admin/page.tsx` — admin dashboard
  - Runner health table with slots used/max, queue depth, last heartbeat, status chip
  - Queue depth cards (runs + schedules) with waiting/active/delayed counts
  - Stuck runs table with "Force fail" button
  - DB stats: total runs, total tests, artifact storage GB
  - Auto-refreshes every 30s
- [x] Admin link added to sidebar nav (OWNER-only, gated by DB lookup in layout)

#### Part C — Visual regression baselines (stretch)
- [x] `VisualBaseline` model added to `packages/db/prisma/schema.prisma`
  - Unique on `(testCaseId, name, browser)`
  - `approvedAt`/`approvedBy` fields for review workflow
- [x] `apps/api/src/routes/v1/baselineRoutes.ts`
  - `GET /tests/:id/baselines` — list with presigned thumbnail URLs
  - `POST /tests/:id/baselines/:baselineId/approve` — EDITOR+
  - `DELETE /tests/:id/baselines/:baselineId` — EDITOR+
- [x] `apps/web/app/(app)/projects/[slug]/tests/[testId]/baselines/page.tsx`
  - Baseline grid with screenshot thumbnails, browser badges
  - "Pending review" badge for unapproved baselines
  - Approve / Delete actions

#### Part D — One-way git import (stretch)
- [x] `apps/api/src/routes/v1/importRoutes.ts`
  - `POST /projects/:id/import` — upserts TestCase + TestVersion for each `.spec.ts` file
  - Returns `{ created, updated, errors }` summary
- [x] `apps/cli/src/commands/push.ts` — already implemented with ora progress bar and summary output

#### Part E — Helm chart
- [x] `infra/helm/sentinel/Chart.yaml`
- [x] `infra/helm/sentinel/values.yaml` — api, web, runner, postgresql, redis, minio
- [x] `infra/helm/sentinel/templates/_helpers.tpl` — `sentinel.fullname`, labels, image helper
- [x] `infra/helm/sentinel/templates/deployment-api.yaml` — with liveness/readiness probes
- [x] `infra/helm/sentinel/templates/deployment-web.yaml`
- [x] `infra/helm/sentinel/templates/deployment-runner.yaml` — Docker socket support for docker sandbox
- [x] `infra/helm/sentinel/templates/service-api.yaml`
- [x] `infra/helm/sentinel/templates/service-web.yaml`
- [x] `infra/helm/sentinel/templates/ingress.yaml` — conditional, routes web + /api + /internal + /hooks
- [x] `infra/helm/sentinel/templates/configmap.yaml`
- [x] `infra/helm/sentinel/templates/secret.yaml` — placeholder with production note

#### Part F — E2E test suite for Sentinel itself
- [x] `e2e/playwright.config.ts` — points at localhost:3000, 1 worker, retain-on-failure
- [x] `e2e/tests/smoke.spec.ts`
  - `signup → create project → write test → run → see green result`
  - `failing test shows error + screenshot`
  - `RBAC: viewer cannot trigger runs`
- [x] `e2e/package.json`

#### Part G — server.ts route wiring
- [x] `phase3Routes` registered at `/api/v1`
- [x] `hookRoutes` registered at root (capture webhook endpoint)
- [x] `aiRoutes` registered at `/api/v1` (was already present)
- [x] `adminRoutes` registered at `/api/v1`
- [x] `baselineRoutes` registered at `/api/v1`
- [x] `importRoutes` registered at `/api/v1`
- [x] `startRetentionReaper` + `startStatsReconciler` called in `start()`

---

## Architecture decisions

See `docs/decisions/` for ADRs. Pre-decided decisions from §19 of the spec are not re-litigated.

## Negotiable items changed

None — all "Locked" items implemented as specified.
