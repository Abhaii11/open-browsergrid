# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` (latest `main`) | Yes |

---

## Security Considerations for Self-Hosting

OpenBrowserGrid exposes a Chrome DevTools Protocol (CDP) WebSocket endpoint that allows connected clients to navigate pages and execute JavaScript inside managed Chromium instances. When deploying outside `localhost`:

- **Always set `API_KEY`** in production environments so unauthenticated clients cannot open browser sessions.
- **Bind behind a reverse proxy** (Nginx, Caddy, Traefik) with TLS (`https://` / `wss://`) when exposing over public networks.
- **Restrict network egress** inside containers if running untrusted AI agent workloads.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability (such as authentication bypass, container escape, XSS in the dashboard, or path traversal):

1. Use [GitHub Private Vulnerability Reporting](https://github.com/Abhaii11/open-browsergrid/security/advisories/new) if enabled on the repository, **or**
2. Email the maintainer directly at `rautabhay66@gmail.com` with `[SECURITY] OpenBrowserGrid` in the subject line.

Please include:
- A clear description of the vulnerability and potential impact.
- Steps to reproduce or a minimal proof-of-concept.
- Affected version or commit hash.

You can expect an initial response within 48 hours and coordinated disclosure once a fix is released.
