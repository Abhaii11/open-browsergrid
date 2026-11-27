import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGridConfig } from './config.js';
import { createLogger } from './logger.js';
import { createGridServer } from './server.js';
import type { GridConfig } from './types.js';

export * from './types.js';
export * from './config.js';
export * from './logger.js';
export * from './server.js';
export * from './sessionManager.js';
export * from './browserLauncher.js';
export * from './cdpProxy.js';
export * from './stealth.js';

export function runServer(userConfig: Partial<GridConfig> = {}) {
  const config = resolveGridConfig(userConfig);
  const logger = createLogger({
    level: config.logLevel,
    format: config.logFormat,
    bindings: { component: 'grid' },
  });

  const app = createGridServer(config, { logger });

  const shutdown = async (signal: string) => {
    logger.info('Stopping OpenBrowserGrid...', { signal });
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  void app.start().then(() => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    if (config.logFormat === 'json') {
      logger.info('OpenBrowserGrid started', {
        dashboardUrl: `http://${displayHost}:${config.port}`,
        cdpEndpoint: `ws://${displayHost}:${config.port}/connect`,
        maxSessions: config.maxSessions,
        queueTimeoutMs: config.queueTimeoutMs,
        stealth: config.stealth,
        headless: config.headless,
        authEnabled: Boolean(config.apiKey),
      });
      return;
    }

    console.log(`
┌────────────────────────────────────────────────────────┐
│               ⚡ OpenBrowserGrid v0.1.0                │
│       Self-Hosted Cloud Browser Infrastructure         │
└────────────────────────────────────────────────────────┘

  Dashboard:       http://${displayHost}:${config.port}
  CDP Endpoint:    ws://${displayHost}:${config.port}/connect
  Max Sessions:    ${config.maxSessions}
  Queue Timeout:   ${config.queueTimeoutMs}ms (max ${config.maxQueueSize} queued)
  Stealth Mode:    ${config.stealth ? 'Enabled' : 'Disabled'}
  Headless:        ${config.headless ? 'Yes' : 'No'}
  Auth:            ${config.apiKey ? 'Enabled (API Key set)' : 'Disabled (Public)'}

Press Ctrl+C to stop.
    `);
  });

  return app;
}

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
