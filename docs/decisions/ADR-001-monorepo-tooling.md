# ADR-001: Monorepo Tooling — pnpm workspaces + Turborepo

**Date:** 2026-09-09  
**Status:** Accepted (Locked per spec §3)

## Context

Sentinel is a multi-app system (web, api, runner, cli) sharing types, schemas, and config. We need a monorepo tool that supports incremental builds, caching, and parallel task execution.

## Decision

Use **pnpm workspaces** for package management and **Turborepo** for task orchestration.

## Consequences

- `pnpm install --frozen-lockfile` in CI ensures reproducible installs.
- Turborepo `build` DAG means `@sentinel/shared` and `@sentinel/db` build before apps that depend on them.
- Remote cache (Vercel or self-hosted) can be added later for faster CI.
- All workspace packages use `workspace:*` semver constraint so internal deps always resolve to the local copy.
