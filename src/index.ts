import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGridServer } from './server.js';
import type { GridConfig } from './types.js';

export * from './types.js';
export * from './server.js';
export * from './sessionManager.js';
export * from './browserLauncher.js';
export * from './cdpProxy.js';
export * from './stealth.js';

export function runServer(userConfig?: Partial<GridConfig>) {
  const config: GridConfig = {
    port: userConfig?.port || parseInt(process.env.PORT || '3000', 10),
    host: userConfig?.host || process.env.HOST || '0.0.0.0',
    maxSessions: userConfig?.maxSessions || parseInt(process.env.MAX_SESSIONS || '10', 10),
    sessionTimeoutMs:
      userConfig?.sessionTimeoutMs || parseInt(process.env.SESSION_TIMEOUT_MS || '300000', 10), // 5 min
    apiKey: userConfig?.apiKey || process.env.API_KEY,
    headless: userConfig?.headless ?? process.env.HEADLESS !== 'false',
    stealth: userConfig?.stealth ?? process.env.STEALTH !== 'false',
    executablePath: userConfig?.executablePath || process.env.CHROME_PATH,
  };

  const app = createGridServer(config);

  const shutdown = async () => {
    console.log('\nStopping OpenBrowserGrid...');
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  app.start().then(() => {
    console.log(`
┌────────────────────────────────────────────────────────┐
│               ⚡ OpenBrowserGrid v0.1.0                │
│       Self-Hosted Cloud Browser Infrastructure         │
└────────────────────────────────────────────────────────┘

  Dashboard:       http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}
  CDP Endpoint:    ws://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/connect
  Max Sessions:    ${config.maxSessions}
  Stealth Mode:    ${config.stealth ? 'Enabled' : 'Disabled'}
  Headless:        ${config.headless ? 'Yes' : 'No'}
  Auth:            ${config.apiKey ? 'Enabled (API Key set)' : 'Disabled (Public)'}

Press Ctrl+C to stop.
    `);
  });

  return app;
}

// Auto-run if executed directly
const entryArg = process.argv[1];
if (entryArg) {
  try {
    const entryUrl = fileURLToPath(import.meta.url);
    if (fs.realpathSync(entryUrl) === fs.realpathSync(path.resolve(entryArg))) {
      runServer();
    }
  } catch {
    // ignore path resolution failures when imported programmatically
  }
}
