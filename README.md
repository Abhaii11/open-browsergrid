<div align="center">

# ⚡ OpenBrowserGrid

### Self-Hosted Cloud Browser Infrastructure for AI Agents & Automation
**Open-Source Alternative to Browserbase, Browserless, and Steel**

[![CI](https://github.com/Abhaii11/open-browsergrid/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhaii11/open-browsergrid/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Abhaii11/open-browsergrid/actions/workflows/codeql.yml/badge.svg)](https://github.com/Abhaii11/open-browsergrid/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Abhaii11/open-browsergrid/badge)](https://scorecard.dev/viewer/?uri=github.com/Abhaii11/open-browsergrid)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/compatible%20with-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)

<p align="center">
  Stop paying $50–$300/month for hosted browser clouds.<br>
  Run isolated, stealth Chromium browser instances on your own servers with a single Docker command.
</p>

[Quickstart](#-quickstart) •
[Features](#-features) •
[Feature Comparison](#-comparison) •
[Connect Examples](#-connect-examples) •
[Architecture](#-architecture)

---

</div>

## 💡 Why OpenBrowserGrid?

Running headless Chromium for AI agents (like `browser-use`, `Stagehand`, or custom LLM scrapers) in production is notoriously frustrating:
- **Commercial SaaS is expensive**: Browserbase, Browserless, and Steel charge hefty subscription and per-hour fees.
- **Resource leaks**: Headless Chrome creates zombie processes, consumes gigabytes of RAM, and crashes containers.
- **Bot detection**: Plain headless browsers get blocked by Cloudflare and Akamai immediately.
- **Zero visibility**: When an agent gets stuck, you can't see what the browser is doing.

**OpenBrowserGrid solves all four:**
- 🛡️ **Stealth Anti-Detection by Default**: Masks `navigator.webdriver`, mocks `chrome.runtime`, and patches browser fingerprints.
- 📺 **Live Web Dashboard with Screencasting**: Watch what your AI agent or Playwright test is doing in real-time at 30fps.
- ⚡ **Zero Cloud Cost**: Deploy in seconds on any $5 VPS, home lab, or Docker host.
- 🔌 **100% Drop-in Compatible**: Connect with standard Playwright `connectOverCDP()`, Puppeteer, or Python `browser-use`.

---

## 🚀 Quickstart

### Run with Docker (Recommended)

```bash
docker run -d \
  --name open-browsergrid \
  -p 3000:3000 \
  --shm-size=2gb \
  ghcr.io/abhaii11/open-browsergrid:latest
```

Open **`http://localhost:3000`** in your browser to access the live dashboard!

### Run with Docker Compose

```yaml
services:
  browsergrid:
    image: ghcr.io/abhaii11/open-browsergrid:latest
    ports:
      - "3000:3000"
    shm_size: 2gb
    restart: unless-stopped
```

```bash
docker compose up -d
```

### Run Locally (Node.js)

```bash
# Clone the repository
git clone https://github.com/Abhaii11/open-browsergrid.git
cd open-browsergrid

# Install dependencies and build
npm install
npm run build

# Start the server
npm start
```

---

## 🔌 Connect Examples

### 1. Playwright (TypeScript / JavaScript)

Connect to OpenBrowserGrid via standard Chrome DevTools Protocol (CDP):

```typescript
import { chromium } from 'playwright';

// Connect to your self-hosted browser grid
const browser = await chromium.connectOverCDP('ws://localhost:3000/connect');

const context = browser.contexts()[0] || await browser.newContext();
const page = await context.newPage();

await page.goto('https://news.ycombinator.com');
console.log('Title:', await page.title());

// Watch live on http://localhost:3000 while this executes!
await browser.close();
```

### 2. Python (`browser-use` & AI Agents)

Works out of the box with [browser-use](https://github.com/browser-use/browser-use) and LangChain:

```python
import asyncio
from browser_use import Agent, Browser, BrowserConfig
from langchain_openai import ChatOpenAI

async def main():
    browser = Browser(config=BrowserConfig(
        cdp_url="ws://localhost:3000/connect"
    ))
    
    agent = Agent(
        task="Find top trending stories on Hacker News and summarize them",
        llm=ChatOpenAI(model="gpt-4o"),
        browser=browser
    )
    await agent.run()

asyncio.run(main())
```

### 3. Puppeteer

```javascript
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:3000/connect'
});

const page = await browser.newPage();
await page.goto('https://example.com');
await browser.close();
```

---

## 📊 Comparison

| Feature | OpenBrowserGrid | Browserbase | Browserless |
| :--- | :---: | :---: | :---: |
| **Pricing** | **100% Free & Open-Source** | $49 - $299/mo | $50 - $250/mo |
| **Self-Hostable** | ✅ **One-Line Docker** | ❌ Proprietary Cloud | ⚠️ Complex Enterprise Setup |
| **Live Visual Screencast** | ✅ Built-in Dark Mode UI | ✅ Web UI | ⚠️ Separate VNC |
| **Anti-Bot Stealth** | ✅ Built-in | ✅ Built-in | ⚠️ Paid Addon |
| **Playwright / CDP Support** | ✅ Standard `ws://` | ✅ Standard `ws://` | ✅ Standard `ws://` |
| **Zombie Process Reaper** | ✅ Auto-cleanup & tmpdir purge | Managed | Managed |

---

## 🛠️ Configuration & Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP API, dashboard, and WebSocket server |
| `HOST` | `0.0.0.0` | Host interface to bind |
| `MAX_SESSIONS` | `10` | Maximum simultaneous browser sessions allowed |
| `SESSION_TIMEOUT_MS` | `300000` | Idle timeout before cleaning up unused sessions (5 min) |
| `QUEUE_TIMEOUT_MS` | `15000` | Max wait time for a browser slot when pool is full (`0` disables queue) |
| `MAX_QUEUE_SIZE` | `25` | Maximum waiting session requests when at `MAX_SESSIONS` |
| `MAX_SESSION_MEMORY_MB` | `0` | Auto-kill sessions exceeding RSS memory in MiB (`0` disables) |
| `HEARTBEAT_INTERVAL_MS` | `15000` | WebSocket ping/pong heartbeat interval (`0` disables) |
| `LOG_LEVEL` | `info` | Structured log level (`debug`, `info`, `warn`, `error`, `silent`) |
| `LOG_FORMAT` | `pretty` / `json` | Output format (`json` defaults when `NODE_ENV=production`) |
| `STEALTH` | `true` | Enable anti-detection flags and runtime patches |
| `HEADLESS` | `true` | Run Chromium in headless mode |
| `API_KEY` | *(None)* | Optional Bearer token / API key to require for connections |
| `CHROME_PATH` | *(Auto)* | Custom path to Chromium / Google Chrome binary |
| `PROFILES_DIR` | *(Temp dir)* | Persistent browser profiles directory (`profileId`) |

---

## 🗺️ Roadmap

- [x] Ephemeral isolated Chromium browser pool
- [x] Bidirectional CDP WebSocket Proxy
- [x] Anti-detection stealth evasion injection (WebGL, Canvas, AudioContext, Client Hints, timezone/locale)
- [x] Persistent browser profiles (`profileId`) & profile management API
- [x] Live web dashboard with real-time screencast canvas
- [x] Docker & Docker Compose setup
- [ ] Session video recording to WebM / MP4
- [ ] Built-in proxy rotator (Residential & HTTP proxies)
- [ ] Token-efficient DOM accessibility tree extractor for LLMs

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md), or open an issue on the [issues page](https://github.com/Abhaii11/open-browsergrid/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feat/amazing-feature`)
3. Commit your Changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the Branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 🔒 Security

Please see [SECURITY.md](SECURITY.md) for deployment hardening guidance and responsible vulnerability reporting.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
