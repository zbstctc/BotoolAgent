# Version Management Design

**Date**: 2026-02-17
**Status**: Approved

## Decision

Semantic Versioning (SemVer) with Conventional Commits, automated via GitHub Actions.

## Version Source

Single source of truth: **Git tags** (e.g., `v1.0.0`).

## Bump Rules

| Commit prefix | Bump | Example |
|---|---|---|
| `fix:` | PATCH (1.0.0 -> 1.0.1) | Bug fix |
| `feat:` | MINOR (1.0.0 -> 1.1.0) | New feature |
| `feat!:` / `BREAKING CHANGE:` | MAJOR (1.0.0 -> 2.0.0) | Breaking change |
| `perf:`, `refactor:`, `chore:` | PATCH | Optimization/refactor |

## Automation

GitHub Actions workflow triggers on push to main. Scans commits since last tag, calculates bump, creates new tag + GitHub Release.

## Frontend Display

Header shows version badge: `Botool Agent [Viewer] v1.0.0`. Version injected at build time via `NEXT_PUBLIC_APP_VERSION` from `git describe --tags`.

## Files Changed

- `.github/workflows/version-bump.yml` — new CI workflow
- `viewer/next.config.ts` — inject version env var
- `viewer/src/components/Header.tsx` — display version badge
