#!/usr/bin/env node

import { runServer } from './index.js';
import type { GridConfig, LogFormat, LogLevel } from './types.js';

const args = process.argv.slice(2);
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
    console.log(`
OpenBrowserGrid CLI

Usage:
  browsergrid [options]

Options:
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
  --help                      Show help
`);
    process.exit(0);
  }
}

runServer(config);
