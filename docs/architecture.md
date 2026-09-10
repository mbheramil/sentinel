# Sentinel Architecture

## Component Diagram

```
                    ┌──────────────────────────────────────┐
                    │  Browser (Next.js App Router SPA-ish)│
                    │  dashboard · editor · run detail     │
                    └───────────┬──────────────┬───────────┘
                     HTTPS/REST │              │ SSE (live run events)
                                ▼              ▼
                    ┌──────────────────────────────────────┐
                    │  apps/api  (Fastify + Zod + OpenAPI) │
                    │  auth · CRUD · run orchestration     │
                    └──┬─────────┬──────────┬──────────────┘
                       │         │          │
            Prisma     │         │ BullMQ   │ presigned URLs
                       ▼         ▼          ▼
             ┌──────────────┐ ┌────────┐ ┌──────────────────┐
             │ PostgreSQL   │ │ Redis  │ │ S3 / MinIO       │
             │ metadata     │ │ queue  │ │ artifacts        │
             │ results      │ │ pubsub │ │ traces·video·png │
             └──────────────┘ └───┬────┘ └──────────────────┘
                                  │ job claim + heartbeat
                                  ▼
             ┌───────────────────────────────────────────────┐
             │ apps/runner (supervisor, N replicas)          │
             │  ├─ materialise workspace from TestVersions   │
             │  ├─ spawn `playwright test` in SANDBOX        │
             │  ├─ custom reporter → NDJSON event stream     │
             │  └─ upload artifacts, POST results            │
             └───────────────────────────────────────────────┘
                                  │ docker run --rm (per run)
                                  ▼
             ┌───────────────────────────────────────────────┐
             │ Ephemeral execution container                 │
             │ mcr.microsoft.com/playwright:v1.X-noble       │
             │ non-root · read-only FS · no host net · rlimits│
             └───────────────────────────────────────────────┘
```

## Key Design Decisions

### Why a separate Fastify API instead of Next.js route handlers?

The runner needs a stable, versioned, auth'd machine API independent of the web app's deploy cadence, and long-lived SSE + queue producers are awkward in serverless-shaped Next handlers. **Locked.**

### Why Docker-per-shard sandboxing?

Sentinel runs arbitrary user-supplied JavaScript with a full browser. Kernel-level isolation via Docker is non-negotiable. An in-process execution model would allow a malicious test to read environment variables containing database credentials. See `docs/security.md` for the full threat model.

### Why SSE instead of WebSockets?

Unidirectional server→client fits the live log stream use case. SSE survives proxies better, supports native reconnect via `Last-Event-ID`, and requires no WebSocket server infrastructure. **Locked.**

### Why Postgres for results and S3 for blobs?

Never put videos in the database. Postgres handles relational metadata and queries (flake scoring, history, filtering). S3/MinIO handles blobs with lifecycle rules for automatic expiration. **Locked.**

## Data Flow

### Flow A — Manual run

1. `POST /api/v1/projects/:id/runs` `{ suiteId, environmentId, browsers[], shardCount }`
2. API validates quota + permissions, creates `Run` (status `QUEUED`) and `RunTest` rows
3. API snapshots each test into a `TestVersion` if the working copy is dirty
4. API enqueues one BullMQ job per shard on queue `runs`, returns `201 { runId }`
5. Runner claims job, resolves the `Run`, materialises a workspace, executes, streams events
6. Runner publishes each event to Redis channel `run:{runId}` **and** persists via the internal API
7. Web subscribes `GET /api/v1/runs/:id/events` (SSE) → API bridges Redis pub/sub → browser
8. On completion the runner uploads artifacts, PATCHes final status; API fires notifications

### Flow B — Scheduled run

A `repeatable` BullMQ job per enabled `Schedule` (cron + IANA timezone) enqueues onto queue `schedules`; its handler calls the same internal `createRun()` service.

### Flow C — CI trigger

`sentinel run --project <slug> --wait --api-key $SENTINEL_KEY` → same POST, then long-polls `GET /runs/:id`, prints a summary table, exits non-zero on failure.
