# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
