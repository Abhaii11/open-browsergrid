#!/usr/bin/env node

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { runServer } from './index.js';
import type { GridConfig, LogFormat, LogLevel, SessionSummary } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() })
      );
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
  });
}

function httpPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() })
      );
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Request timed out')));
    req.end(body);
  });
}

function httpGetBinary(url: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Pretty-print helpers
// ──────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function statusColor(s: string): string {
  if (s === 'active') return `${GREEN}${s}${RESET}`;
  if (s === 'ready') return `${CYAN}${s}${RESET}`;
  if (s === 'launching') return `${YELLOW}${s}${RESET}`;
  return `${DIM}${s}${RESET}`;
}

function padEnd(s: string, n: number): string {
  // Strip ANSI escape codes for accurate length calculation
  const ansiRe = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const stripped = s.replace(ansiRe, '');
  return s + ' '.repeat(Math.max(0, n - stripped.length));
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function printSessionTable(sessions: SessionSummary[]): void {
  if (sessions.length === 0) {
    console.log(`${DIM}No active sessions.${RESET}`);
    return;
  }
  const header = [
    padEnd(`${BOLD}ID${RESET}`, 20),
    padEnd(`${BOLD}STATUS${RESET}`, 16),
    padEnd(`${BOLD}UPTIME${RESET}`, 10),
    padEnd(`${BOLD}MEM${RESET}`, 8),
    padEnd(`${BOLD}URL${RESET}`, 50),
  ].join('  ');
  const divider = '─'.repeat(110);
  console.log(divider);
  console.log(header);
  console.log(divider);
  for (const s of sessions) {
    const mem = s.memoryMb ? `${s.memoryMb.toFixed(0)}MB` : '—';
    const url = (s.url ?? '—').slice(0, 48);
    console.log(
      [
        padEnd(s.id, 20),
        padEnd(statusColor(s.status), 16),
        padEnd(formatUptime(s.uptimeSeconds), 10),
        padEnd(mem, 8),
        url,
      ].join('  ')
    );
  }
  console.log(divider);
  console.log(`${DIM}Total: ${sessions.length} session(s)${RESET}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Subcommand: status
// ──────────────────────────────────────────────────────────────────────────────

async function cmdStatus(argv: string[]): Promise<void> {
  let baseUrl = 'http://localhost:3000';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' || argv[i] === '-u') baseUrl = argv[++i] ?? baseUrl;
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/sessions`;
  let res: { status: number; body: string };
  try {
    res = await httpGet(url);
  } catch (err) {
    console.error(
      `${RED}Error: could not reach ${url} — ${err instanceof Error ? err.message : String(err)}${RESET}`
    );
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error(`${RED}Server returned HTTP ${res.status}: ${res.body}${RESET}`);
    process.exit(1);
  }
  const sessions: SessionSummary[] = JSON.parse(res.body) as SessionSummary[];
  printSessionTable(sessions);
}

// ──────────────────────────────────────────────────────────────────────────────
// Subcommand: screenshot
// ──────────────────────────────────────────────────────────────────────────────

async function cmdScreenshot(argv: string[]): Promise<void> {
  let baseUrl = 'http://localhost:3000';
  let outputPath = '';
  let sessionId = '';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' || argv[i] === '-u') {
      baseUrl = argv[++i] ?? baseUrl;
    } else if (argv[i] === '--output' || argv[i] === '-o') {
      outputPath = argv[++i] ?? '';
    } else if (!argv[i].startsWith('-')) {
      sessionId = argv[i];
    }
  }

  if (!sessionId) {
    console.error(
      `${RED}Usage: browsergrid screenshot <session-id> [--url <host>] [--output <file.png>]${RESET}`
    );
    process.exit(1);
  }

  if (!outputPath) {
    outputPath = `screenshot-${sessionId}-${Date.now()}.png`;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/sessions/${sessionId}/screenshot`;
  let res: { status: number; body: Buffer };
  try {
    res = await httpGetBinary(url);
  } catch (err) {
    console.error(`${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error(`${RED}Server returned HTTP ${res.status}: ${res.body.toString()}${RESET}`);
    process.exit(1);
  }
  fs.writeFileSync(path.resolve(outputPath), res.body);
  console.log(
    `${GREEN}✓ Screenshot saved to ${path.resolve(outputPath)} (${res.body.length} bytes)${RESET}`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Subcommand: logs — stream console output from a session via CDP
// ──────────────────────────────────────────────────────────────────────────────

async function cmdLogs(argv: string[]): Promise<void> {
  let baseUrl = 'http://localhost:3000';
  let sessionId = '';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' || argv[i] === '-u') {
      baseUrl = argv[++i] ?? baseUrl;
    } else if (!argv[i].startsWith('-')) {
      sessionId = argv[i];
    }
  }

  if (!sessionId) {
    console.error(`${RED}Usage: browsergrid logs <session-id> [--url <host>]${RESET}`);
    process.exit(1);
  }

  // Resolve the session's cdpPort via the REST API summary
  const detailUrl = `${baseUrl.replace(/\/$/, '')}/api/sessions/${sessionId}`;
  let detailRes: { status: number; body: string };
  try {
    detailRes = await httpGet(detailUrl);
  } catch (err) {
    console.error(`${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
    process.exit(1);
  }
  if (detailRes.status !== 200) {
    console.error(`${RED}Session ${sessionId} not found (HTTP ${detailRes.status})${RESET}`);
    process.exit(1);
  }

  // We stream logs by connecting to the CDP proxy at /connect/:id and
  // subscribing to Runtime.consoleAPICalled and Log.entryAdded events.
  const enableRes = await httpPost(
    `${baseUrl.replace(/\/$/, '')}/api/sessions/${sessionId}/execute`,
    JSON.stringify({ method: 'Runtime.enable', params: {} })
  );
  if (enableRes.status !== 200) {
    console.error(`${RED}Could not enable Runtime domain: ${enableRes.body}${RESET}`);
    process.exit(1);
  }

  console.log(
    `${CYAN}Streaming console logs for session ${BOLD}${sessionId}${RESET}${CYAN} (Ctrl-C to stop)${RESET}`
  );
  console.log(
    `${DIM}Note: connects to the existing WebSocket CDP proxy at ${baseUrl}/connect/${sessionId}${RESET}\n`
  );

  // Connect to the CDP proxy endpoint and subscribe to Runtime events
  const wsUrl = `${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/connect/${sessionId}`;
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  ws.once('open', () => {
    ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable', params: {} }));
    ws.send(JSON.stringify({ id: msgId++, method: 'Log.enable', params: {} }));
  });

  ws.on('message', (raw) => {
    let msg: {
      method?: string;
      params?: {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        text?: string;
        level?: string;
      };
    };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }

    if (msg.method === 'Runtime.consoleAPICalled' && msg.params) {
      const type = msg.params.type ?? 'log';
      const args = (msg.params.args ?? []).map((a) =>
        a.value !== undefined ? String(a.value) : (a.description ?? '')
      );
      const color =
        type === 'error' ? RED : type === 'warn' ? YELLOW : type === 'info' ? CYAN : RESET;
      console.log(`${color}[${type.toUpperCase()}]${RESET} ${args.join(' ')}`);
    }

    if (msg.method === 'Log.entryAdded' && msg.params) {
      const entry = msg.params as { level?: string; text?: string };
      const color = entry.level === 'error' ? RED : entry.level === 'warning' ? YELLOW : DIM;
      console.log(
        `${color}[LOG/${(entry.level ?? 'info').toUpperCase()}]${RESET} ${entry.text ?? ''}`
      );
    }
  });

  ws.on('error', (err) => {
    console.error(`${RED}WebSocket error: ${err.message}${RESET}`);
    process.exit(1);
  });

  ws.on('close', () => {
    console.log(`\n${DIM}Session closed.${RESET}`);
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {
    /* runs until process signal */
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Argument parsing and dispatch
// ──────────────────────────────────────────────────────────────────────────────

const HELP = `
OpenBrowserGrid CLI

Usage:
  browsergrid [options]                 Start the server
  browsergrid status [--url <host>]     Show running sessions
  browsergrid screenshot <id> [opts]    Capture a session screenshot
  browsergrid logs <id> [--url <host>]  Stream browser console logs

Server Options:
  -p, --port <number>         Port to listen on (default: 3000)
  -h, --host <string>         Host interface to bind (default: 0.0.0.0)
  --max-sessions <number>     Maximum concurrent browser sessions (default: 10)
  --queue-timeout <ms>        Max time to wait when pool is full (default: 15000)
  --max-queue <number>        Max queued requests when pool is full (default: 25)
  --max-memory-mb <mb>        Auto-terminate sessions above RSS limit (default: 0, disabled)
  --profiles-dir <path>       Directory to store persistent browser profiles
  --log-level <level>         Log level: debug | info | warn | error | silent
  --log-format <format>       Log format: pretty | json
  --api-key <string>          Require API key / bearer token for connections
  --headful                   Run browser in visible (non-headless) mode
  --no-stealth                Disable anti-detection patches

screenshot Options:
  -o, --output <file.png>     Output file path (default: screenshot-<id>-<ts>.png)
  -u, --url <host>            Server base URL (default: http://localhost:3000)

logs Options:
  -u, --url <host>            Server base URL (default: http://localhost:3000)
`;

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === 'status') {
  void cmdStatus(args.slice(1));
} else if (subcommand === 'screenshot') {
  void cmdScreenshot(args.slice(1));
} else if (subcommand === 'logs') {
  void cmdLogs(args.slice(1));
} else {
  // Server startup mode
  const config: Partial<GridConfig> = {};

  function requireInt(flag: string, raw: string | undefined, min = 0): number {
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isNaN(parsed) || parsed < min) {
      console.error(`Invalid value for ${flag}: expected integer >= ${min}`);
      process.exit(1);
    }
    return parsed;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      config.port = requireInt(arg, args[++i], 0);
    } else if (arg === '--host' || arg === '-h') {
      config.host = args[++i];
    } else if (arg === '--max-sessions') {
      config.maxSessions = requireInt(arg, args[++i], 1);
    } else if (arg === '--queue-timeout') {
      config.queueTimeoutMs = requireInt(arg, args[++i], 0);
    } else if (arg === '--max-queue') {
      config.maxQueueSize = requireInt(arg, args[++i], 0);
    } else if (arg === '--max-memory-mb') {
      config.maxSessionMemoryMb = requireInt(arg, args[++i], 0);
    } else if (arg === '--profiles-dir') {
      config.profilesDir = args[++i];
    } else if (arg === '--log-level') {
      config.logLevel = args[++i] as LogLevel;
    } else if (arg === '--log-format') {
      config.logFormat = args[++i] as LogFormat;
    } else if (arg === '--api-key' || arg === '--token') {
      config.apiKey = args[++i];
    } else if (arg === '--no-headless' || arg === '--headful') {
      config.headless = false;
    } else if (arg === '--no-stealth') {
      config.stealth = false;
    } else if (arg === '--help') {
      console.log(HELP);
      process.exit(0);
    }
  }

  runServer(config);
}
