# Contributing to OpenBrowserGrid

Thank you for considering contributing to **OpenBrowserGrid**! Community contributions—whether bug reports, documentation fixes, stealth improvements, or new features—are what make open-source infrastructure thrive.

---

## Development Setup

### Prerequisites

- **Node.js** `>= 20.0.0` (Node 22 LTS recommended)
- **npm** `>= 10.0.0`
- **Google Chrome** or **Chromium** installed locally (or Playwright browsers)
- **Docker** (optional, for testing container builds)

### Local Installation

```bash
# 1. Fork the repository on GitHub and clone your fork
git clone https://github.com/<your-username>/open-browsergrid.git
cd open-browsergrid

# 2. Install dependencies
npm install

# 3. Verify typecheck, lint, build, and tests
npm run lint
npm run typecheck
npm run build
npm test
```

### Running in Development Mode

```bash
# Start the server with live reload on file changes
npm run dev
```

The dashboard will be available at `http://localhost:3000` and the CDP WebSocket endpoint at `ws://localhost:3000/connect`.

---

## Project Architecture

```text
open-browsergrid/
├── src/
│   ├── browserLauncher.ts   # Cross-platform Chromium discovery & process spawning
│   ├── cdpProxy.ts          # Bidirectional WebSocket CDP proxy + screencast tap
│   ├── cli.ts               # CLI flag parsing entry point
│   ├── dashboard.ts         # Embedded dark-mode dashboard UI
│   ├── index.ts             # Programmatic API & server runner
│   ├── server.ts            # HTTP REST API & WebSocket upgrade router
│   ├── sessionManager.ts    # Session pool lifecycle & idle reaper
│   ├── stealth.ts           # Anti-detection flags & browser runtime scripts
│   └── types.ts             # Shared TypeScript interfaces
├── tests/                   # Node native test runner suites
├── examples/                # Reference integrations (Playwright, browser-use)
└── .github/                 # CI/CD workflows & issue/PR templates
```

---

## Making Changes

1. **Create a descriptive branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
2. **Follow Conventional Commits** for commit messages:
   - `feat:` — a new feature (e.g., `feat(stealth): add canvas noise injection`)
   - `fix:` — a bug fix (e.g., `fix(proxy): handle unexpected browser ws close`)
   - `docs:` — documentation updates
   - `test:` — adding or fixing tests
   - `chore:` — tooling, CI, or dependency updates
   - `refactor:` — code restructuring without behavior changes
3. **Run all quality checks before pushing**:
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run build
   npm test
   ```
4. **Open a Pull Request** against `main` using the PR template and link any related issue.

---

## Reporting Bugs & Requesting Features

- Use the [Bug Report form](https://github.com/Abhaii11/open-browsergrid/issues/new?template=bug_report.yml) for defects, crashes, or regressions.
- Use the [Feature Request form](https://github.com/Abhaii11/open-browsergrid/issues/new?template=feature_request.yml) to propose new capabilities or integrations.
- Before starting work on a large feature, open an issue first to discuss the design with maintainers.
