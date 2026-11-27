# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Advanced stealth profile engine (`resolveStealthProfile`, `buildStealthScript`) with per-session WebGL vendor/renderer spoofing, seeded Canvas LSB & AudioContext fingerprint jitter, Client Hints/User-Agent CDP override, and timezone/locale consistency
- Persistent browser profiles (`profileId`, `PROFILES_DIR`, `--profiles-dir`) with conflict protection (`409 Conflict`) and `/api/profiles` management endpoints
- Structured logger (`src/logger.ts`) with JSON/pretty formatting and `LOG_LEVEL` support
- Shared configuration resolver (`src/config.ts`) and expanded CLI flags (`--queue-timeout`, `--max-queue`, `--max-memory-mb`, `--log-level`, `--log-format`)
- Concurrent slot reservation, FIFO session queuing (`QUEUE_TIMEOUT_MS`, `MAX_QUEUE_SIZE`), and named session re-attachment
- Automatic crash recovery on unexpected Chromium exits and memory RSS watchdog (`MAX_SESSION_MEMORY_MB`)
- WebSocket ping/pong heartbeat and early CDP client frame buffering during browser startup
- Session metadata tags (`metadata`, `tag_*` / `meta_*` query params) and `GET /api/sessions/:id` endpoint
- Expanded unit and integration test suites under `tests/unit/` and `tests/integration/`
- Community documentation (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`)
- Structured GitHub issue templates and PR checklist template
- GitHub Actions CI pipeline (lint, format check, typecheck, build, test, Docker verification)
- Automated Docker GHCR publish and npm release workflows
- ESLint + Prettier + Husky pre-commit tooling

### Fixed
- Align package metadata and documentation with MIT `LICENSE`
- Fix ESM module configuration (`"type": "module"`) for NodeNext compilation and native tests
- Fix dashboard snippet tab initialization and escape rendered session HTML
- Fix Dockerfile `npm ci --omit=dev` failing on `prepare` husky hook by passing `--ignore-scripts` and upgrading base image to Debian Bookworm
- Fix test runner discovery compatibility on Node.js 20 LTS via `scripts/run-tests.mjs`

## [0.1.0] - 2026-11-26

### Added
- Initial release of OpenBrowserGrid
- Isolated Chromium launcher and session manager with idle reaping
- Bidirectional CDP WebSocket proxy compatible with Playwright, Puppeteer, and `browser-use`
- Built-in stealth anti-detection flags and runtime script injection
- Live dark-mode web dashboard with real-time screencast viewer
- Dockerfile and Docker Compose configuration
