#!/usr/bin/env node

import { runServer } from './index.js';
import type { GridConfig } from './types.js';

const args = process.argv.slice(2);
const config: Partial<GridConfig> = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    config.port = parseInt(args[++i], 10);
  } else if (arg === '--host' || arg === '-h') {
    config.host = args[++i];
  } else if (arg === '--max-sessions') {
    config.maxSessions = parseInt(args[++i], 10);
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
  -p, --port <number>       Port to listen on (default: 3000)
  -h, --host <string>       Host interface to bind (default: 0.0.0.0)
  --max-sessions <number>   Maximum concurrent browser sessions (default: 10)
  --api-key <string>        Require API key / bearer token for connections
  --headful                 Run browser in visible (non-headless) mode
  --no-stealth              Disable anti-detection patches
  --help                    Show help
`);
    process.exit(0);
  }
}

runServer(config);
