# Sentinel Security Model

## Threat Model

Sentinel runs **arbitrary user-supplied JavaScript** with a full browser. Anyone who can save a test can attempt RCE on your infrastructure. Even in a single-team self-hosted deployment, treat every test as hostile input.

## Sandboxing (§11.2) — Non-negotiable

Every shard runs in a fresh Docker container with:

- `--rm` (auto-removed on exit)
- Non-root user (`--user pwuser`)
- `--read-only` root filesystem with `tmpfs` at `/tmp` and one writable bind for the workspace
- `--cap-drop=ALL`
- `--security-opt=no-new-privileges`
- Default seccomp profile (never `--privileged`, never `--cap-add=SYS_ADMIN`)
- **No Docker socket inside the container. Ever.**
- Resource limits: `--cpus`, `--memory`, `--memory-swap`, `--pids-limit=512`
- `--ulimit nofile=4096`
- `--shm-size=1g` (Chromium requires it)
- Network: dedicated bridge with **no route to platform's own subnet** (Postgres, Redis, MinIO, internal API, cloud metadata `169.254.169.254`)

The `local` sandbox strategy (spawn as a child process) exists for developer laptops only and refuses to start when `NODE_ENV=production`.

## Static Analysis (§11.3) — Defence in Depth

At test save time, the TypeScript compiler API (not regex) rejects:

- `child_process`, `worker_threads`, `vm`, `module.constructor`, `net`, `dgram`
- Dynamic `require()`/`import()` of non-allow-listed specifiers
- `fs` writes outside `./artifacts`
- Raw `process.env` access outside the `SENTINEL_` prefix

**This is defence in depth — a convenience catch for honest mistakes. It is not the security boundary. The container is.** Never weaken §11.2 because §11.3 exists.

## Secrets at Rest (§11.4)

- Envelope-encrypted with AES-256-GCM using `SENTINEL_ENCRYPTION_KEY`
- Stored as `{ iv, authTag, ciphertext, keyVersion }`
- Key rotation supported via `keyVersion` and a re-encrypt command
- **Write-only through the API** — no endpoint ever returns a plaintext secret to a browser
- Only `/internal/shards/:id/claim` decrypts (runner ↔ API on private network only)

## Web Application Security (§11.5)

- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`; CSRF tokens on all cookie-authed mutations
- Strict CSP; `frame-ancestors 'none'`
- User-generated content (HTML reports, traces, screenshots) served from a separate origin or via presigned URLs with `Content-Disposition: attachment`
- Rate limits: per-IP on auth (5/min), per-key on run creation (60/min)
- Argon2id for passwords and API-key hashes; `timingSafeEqual` comparisons
- RBAC via a single `authorize(actor, action, resource)` service
- Full audit log on: login, key create/revoke, member/role change, secret write, run trigger/cancel, test delete, integration change

## Log Scrubbing

Before any stdout/stderr chunk or error message is persisted or published, every secret value is replaced with `***`. Matching is done on the raw value with a minimum length floor of 4 chars. Base64 and URL-encoded forms are also scrubbed. A leaked password in a run log is a real breach.

## Supply Chain (§11.6)

Runner workspaces install from a prewarmed, offline pnpm store baked into the Playwright Docker image — `--offline`. Users cannot add arbitrary npm dependencies to a test in v1. A curated allow-list ships preinstalled.

## Deployment Checklist

Before deploying to a shared environment:

1. Generate strong `SENTINEL_ENCRYPTION_KEY`, `AUTH_SECRET`, `RUNNER_TOKEN` (32 random bytes each)
2. Ensure `SANDBOX_STRATEGY=docker` (not `local`)
3. Verify the runner container's network cannot reach Postgres/Redis/MinIO
4. Place the internal API (`/internal/*`) behind a network policy — not publicly routable
5. Enable HTTPS (TLS termination at your load balancer / ingress)
6. Review `diagnosticsIgnore` patterns for your project's known noisy third-party scripts
