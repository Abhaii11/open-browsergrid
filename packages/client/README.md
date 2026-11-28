# @open-browsergrid/client

Typed TypeScript/JavaScript client for the [OpenBrowserGrid](https://github.com/Abhaii11/open-browsergrid) REST API.

## Install

```bash
npm install @open-browsergrid/client
```

## Usage

```typescript
import { BrowserGridClient } from '@open-browsergrid/client';
import { chromium } from 'playwright';

const grid = new BrowserGridClient('http://localhost:3000');

// Create a session
const session = await grid.createSession({
  metadata: { task: 'my-scrape' },
});

// Connect with Playwright
const browser = await chromium.connectOverCDP(session.wsEndpoint);
const [page] = browser.contexts()[0].pages();
await page.goto('https://news.ycombinator.com');

// Capture a screenshot via REST API
const png = await grid.screenshot(session.id);
await fs.promises.writeFile('screenshot.png', png);

// Execute arbitrary CDP command
const { result } = await grid.execute(session.id, {
  method: 'Runtime.evaluate',
  params: { expression: 'document.title', returnByValue: true },
});

// Wait for session to be ready
await grid.waitForReady(session.id);

// Close session
await grid.closeSession(session.id);
```

## API

| Method | Description |
|:---|:---|
| `health()` | Get server health and pool stats |
| `listSessions()` | List all active sessions |
| `createSession(opts?)` | Create a new browser session |
| `getSession(id)` | Get session detail |
| `closeSession(id)` | Terminate a session |
| `screenshot(id)` | Capture PNG screenshot → `Uint8Array` |
| `execute(id, opts)` | Run arbitrary CDP command |
| `listProfiles()` | List persistent browser profiles |
| `deleteProfile(id)` | Delete a persistent profile |
| `waitForReady(id, opts?)` | Poll until session is `ready`/`active` |

## With API key

```typescript
const grid = new BrowserGridClient('http://localhost:3000', {
  apiKey: process.env.BROWSERGRID_API_KEY,
});
```
