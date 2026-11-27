import process from 'node:process';
import { resolveLogFormat, resolveLogLevel } from './logger.js';
import type { GridConfig, ResolvedGridConfig } from './types.js';

function parseIntWithDefault(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min) return fallback;
  return parsed;
}

export function resolveGridConfig(userConfig: Partial<GridConfig> = {}): ResolvedGridConfig {
  return {
    port: userConfig.port ?? parseIntWithDefault(process.env.PORT, 3000, 0),
    host: userConfig.host ?? (process.env.HOST || '0.0.0.0'),
    maxSessions: userConfig.maxSessions ?? parseIntWithDefault(process.env.MAX_SESSIONS, 10, 1),
    sessionTimeoutMs:
      userConfig.sessionTimeoutMs ??
      parseIntWithDefault(process.env.SESSION_TIMEOUT_MS, 300000, 1000),
    apiKey: userConfig.apiKey ?? process.env.API_KEY,
    headless: userConfig.headless ?? process.env.HEADLESS !== 'false',
    stealth: userConfig.stealth ?? process.env.STEALTH !== 'false',
    userDataDirBase: userConfig.userDataDirBase ?? process.env.USER_DATA_DIR_BASE,
    executablePath: userConfig.executablePath ?? process.env.CHROME_PATH,
    queueTimeoutMs:
      userConfig.queueTimeoutMs ?? parseIntWithDefault(process.env.QUEUE_TIMEOUT_MS, 15000, 0),
    maxQueueSize: userConfig.maxQueueSize ?? parseIntWithDefault(process.env.MAX_QUEUE_SIZE, 25, 0),
    maxSessionMemoryMb:
      userConfig.maxSessionMemoryMb ?? parseIntWithDefault(process.env.MAX_SESSION_MEMORY_MB, 0, 0),
    heartbeatIntervalMs:
      userConfig.heartbeatIntervalMs ??
      parseIntWithDefault(process.env.HEARTBEAT_INTERVAL_MS, 15000, 0),
    watchdogIntervalMs:
      userConfig.watchdogIntervalMs ??
      parseIntWithDefault(process.env.WATCHDOG_INTERVAL_MS, 10000, 500),
    logLevel: userConfig.logLevel ?? resolveLogLevel(),
    logFormat: userConfig.logFormat ?? resolveLogFormat(),
  };
}
