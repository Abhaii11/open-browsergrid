export function getDashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenBrowserGrid - Cloud Browser Dashboard</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --border: #1f293d;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.2);
      --green: #22c55e;
      --red: #ef4444;
      --amber: #f59e0b;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(17, 23, 38, 0.7);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 700;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .brand-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #000;
    }
    .badge-oss {
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      border: 1px solid var(--accent);
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .btn {
      background: #2563eb;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover { background: #1d4ed8; }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
    }
    .btn-outline:hover {
      border-color: var(--accent);
      color: var(--text);
    }
    .btn-danger {
      background: rgba(239, 68, 68, 0.1);
      color: var(--red);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover { background: var(--red); color: white; }
    
    main {
      padding: 2rem;
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
      flex: 1;
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 2rem;
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .panel h2 {
      font-size: 1rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .session-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      overflow-y: auto;
      max-height: 700px;
    }
    .session-card {
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .session-card:hover, .session-card.active {
      border-color: var(--accent);
      box-shadow: 0 0 16px var(--accent-glow);
    }
    .session-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .session-id {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      font-weight: 600;
    }
    .status-pill {
      font-size: 0.75rem;
      padding: 0.15rem 0.5rem;
      border-radius: 12px;
      font-weight: 600;
    }
    .status-active { background: rgba(34, 197, 94, 0.15); color: var(--green); }
    .status-ready { background: rgba(56, 189, 248, 0.15); color: var(--accent); }
    .session-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      word-break: break-all;
    }

    .viewer-area {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .screencast-container {
      background: #000;
      border: 1px solid var(--border);
      border-radius: 12px;
      min-height: 500px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .screencast-header {
      background: #0d1322;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.875rem;
    }
    .screencast-url {
      font-family: var(--font-mono);
      color: var(--text-muted);
      background: #070a12;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      max-width: 600px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .screen-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      flex: 1;
      background: #05070e;
    }
    .empty-state {
      margin: auto;
      text-align: center;
      color: var(--text-muted);
      padding: 4rem;
    }

    .connect-box {
      background: #070a12;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: #7dd3fc;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .tab {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .tab.active {
      background: #1e293b;
      color: #fff;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <span>OpenBrowserGrid</span>
      <span class="badge-oss">Open-Source</span>
    </div>
    <div class="nav-actions">
      <button class="btn btn-outline" onclick="createNewSession()">+ New Session</button>
      <a href="https://github.com/Abhaii11/open-browsergrid" target="_blank" class="btn btn-outline">GitHub</a>
    </div>
  </header>

  <main>
    <div class="panel">
      <h2>
        <span>Active Sessions</span>
        <span id="session-count" style="color: var(--accent); font-size: 0.875rem;">0</span>
      </h2>
      <div class="session-list" id="session-list">
        <div class="empty-state" style="padding: 2rem 0;">No active sessions</div>
      </div>
    </div>

    <div class="viewer-area">
      <div class="screencast-container">
        <div class="screencast-header">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <strong id="active-session-title">No session selected</strong>
            <span class="screencast-url" id="active-session-url">about:blank</span>
          </div>
          <button id="terminate-btn" class="btn btn-danger" style="display: none;" onclick="terminateCurrentSession()">Terminate</button>
        </div>
        <img id="screencast-img" class="screen-img" style="display: none;" />
        <div class="empty-state" id="screencast-empty">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🖥️</div>
          <div>Connect an agent or Playwright script to watch live</div>
        </div>
      </div>

      <div class="panel">
        <h2>Connect Snippet</h2>
        <div class="tabs">
          <button class="tab active" data-tab="playwright" onclick="showSnippet('playwright')">Playwright (TS/JS)</button>
          <button class="tab" data-tab="python" onclick="showSnippet('python')">Python (browser-use)</button>
          <button class="tab" data-tab="puppeteer" onclick="showSnippet('puppeteer')">Puppeteer</button>
        </div>
        <div class="connect-box" id="code-snippet"></div>
      </div>
    </div>
  </main>

  <script>
    let activeSessionId = null;
    let sessions = [];
    const port = ${port};
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/dashboard/ws';

    const snippets = {
      playwright: \`import { chromium } from 'playwright';

// Connect to OpenBrowserGrid
const browser = await chromium.connectOverCDP('ws://localhost:\${port}/connect');
const context = browser.contexts()[0] || await browser.newContext();
const page = await context.newPage();

await page.goto('https://news.ycombinator.com');
console.log(await page.title());
await browser.close();\`,

      python: \`from browser_use import Agent, Browser, BrowserConfig
from langchain_openai import ChatOpenAI
import asyncio

async def main():
    browser = Browser(config=BrowserConfig(
        cdp_url="ws://localhost:\${port}/connect"
    ))
    agent = Agent(
        task="Find top trending posts on GitHub and print titles",
        llm=ChatOpenAI(model="gpt-4o"),
        browser=browser
    )
    await agent.run()

asyncio.run(main())\`,

      puppeteer: \`const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:\${port}/connect'
});
const page = await browser.newPage();
await page.goto('https://example.com');
await browser.close();\`
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showSnippet(type) {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === type);
      });
      document.getElementById('code-snippet').textContent = snippets[type];
    }
    showSnippet('playwright');

    // Connect WebSocket to receive live state and frame streaming
    function connectWs() {
      const socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'sessions') {
          sessions = data.sessions;
          renderSessions();
        } else if (data.type === 'frame') {
          if (data.sessionId === activeSessionId) {
            const img = document.getElementById('screencast-img');
            img.src = 'data:image/jpeg;base64,' + data.frame;
            img.style.display = 'block';
            document.getElementById('screencast-empty').style.display = 'none';
          }
        }
      };

      socket.onclose = () => {
        setTimeout(connectWs, 2000);
      };
    }
    connectWs();

    function renderSessions() {
      document.getElementById('session-count').textContent = sessions.length;
      const list = document.getElementById('session-list');

      if (sessions.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 2rem 0;">No active sessions</div>';
        activeSessionId = null;
        updateViewer();
        return;
      }

      list.innerHTML = sessions.map(s => {
        const metaTags = s.metadata ? Object.entries(s.metadata)
          .map(([k, v]) => \`<span class="status-pill" style="background: rgba(148,163,184,0.12); color: var(--text-muted); font-size: 0.7rem;">\${escapeHtml(k)}=\${escapeHtml(v)}</span>\`)
          .join(' ') : '';
        const memInfo = typeof s.memoryMb === 'number' ? \` | RAM: \${s.memoryMb}MB\` : '';
        return \`
        <div class="session-card \${s.id === activeSessionId ? 'active' : ''}" onclick="selectSession('\${escapeHtml(s.id)}')">
          <div class="session-header">
            <span class="session-id">\${escapeHtml(s.id)}</span>
            <span class="status-pill status-\${escapeHtml(s.status)}">\${escapeHtml(s.status)}</span>
          </div>
          <div class="session-meta">
            <span>\${escapeHtml(s.title || 'Untitled Page')}</span>
            <span>Uptime: \${s.uptimeSeconds}s | Msgs: \${s.metrics.messagesProxied}\${memInfo}</span>
            \${metaTags ? \`<div style="display:flex;gap:0.25rem;flex-wrap:wrap;margin-top:0.25rem;">\${metaTags}</div>\` : ''}
          </div>
        </div>
      \`;
      }).join('');

      if (!activeSessionId && sessions.length > 0) {
        selectSession(sessions[0].id);
      } else {
        updateViewer();
      }
    }

    function selectSession(id) {
      activeSessionId = id;
      renderSessions();
      updateViewer();
    }

    function updateViewer() {
      const session = sessions.find(s => s.id === activeSessionId);
      const titleEl = document.getElementById('active-session-title');
      const urlEl = document.getElementById('active-session-url');
      const btn = document.getElementById('terminate-btn');

      if (session) {
        titleEl.textContent = 'Session ' + session.id + ' (' + (session.title || 'Loading...') + ')';
        urlEl.textContent = session.url || 'about:blank';
        btn.style.display = 'block';
      } else {
        titleEl.textContent = 'No session selected';
        urlEl.textContent = 'about:blank';
        btn.style.display = 'none';
        document.getElementById('screencast-img').style.display = 'none';
        document.getElementById('screencast-empty').style.display = 'block';
      }
    }

    async function createNewSession() {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const data = await res.json();
      if (data.id) {
        selectSession(data.id);
      }
    }

    async function terminateCurrentSession() {
      if (!activeSessionId) return;
      await fetch('/api/sessions/' + activeSessionId, { method: 'DELETE' });
    }
  </script>
</body>
</html>`;
}
