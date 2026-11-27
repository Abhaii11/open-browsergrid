import type { ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFormat = 'json' | 'pretty';

export interface GridConfig {
  port: number;
  host: string;
  maxSessions: number;
  sessionTimeoutMs: number;
  apiKey?: string;
  headless: boolean;
  stealth: boolean;
  userDataDirBase?: string;
  executablePath?: string;
  queueTimeoutMs?: number;
  maxQueueSize?: number;
  maxSessionMemoryMb?: number;
  heartbeatIntervalMs?: number;
  watchdogIntervalMs?: number;
  logLevel?: LogLevel;
  logFormat?: LogFormat;
}

export interface ResolvedGridConfig extends GridConfig {
  queueTimeoutMs: number;
  maxQueueSize: number;
  maxSessionMemoryMb: number;
  heartbeatIntervalMs: number;
  watchdogIntervalMs: number;
  logLevel: LogLevel;
  logFormat: LogFormat;
}

export interface CreateSessionOptions {
  id?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
}

export interface BrowserSession {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  timeoutMs: number;
  metadata: Record<string, string>;
  process: ChildProcess;
  wsEndpoint: string;
  cdpPort: number;
  clientWs?: WebSocket;
  browserWs?: WebSocket;
  proxyTeardown?: () => void;
  userDataDir: string;
  latestScreenshot?: string; // base64 JPEG
  url?: string;
  title?: string;
  memoryMb?: number;
  status: 'launching' | 'ready' | 'active' | 'closing' | 'closed';
  metrics: {
    messagesProxied: number;
    framesReceived: number;
  };
}

export interface SessionSummary {
  id: string;
  createdAt: number;
  uptimeSeconds: number;
  timeoutMs: number;
  status: string;
  url?: string;
  title?: string;
  memoryMb?: number;
  hasClient: boolean;
  metadata: Record<string, string>;
  metrics: {
    messagesProxied: number;
    framesReceived: number;
  };
}

export interface GridStats {
  activeSessions: number;
  launchingSessions: number;
  queuedRequests: number;
  maxSessions: number;
}

export class InvalidSessionIdError extends Error {
  constructor(id: string) {
    super(`Invalid session ID "${id}": must be 1-64 characters matching [a-zA-Z0-9_-]`);
    this.name = 'InvalidSessionIdError';
  }
}

export class QueueFullError extends Error {
  constructor(maxQueueSize: number) {
    super(`Session queue is full (max ${maxQueueSize} waiting requests)`);
    this.name = 'QueueFullError';
  }
}

export class QueueTimeoutError extends Error {
  constructor(maxSessions: number, timeoutMs: number) {
    super(
      timeoutMs > 0
        ? `Timed out waiting after ${timeoutMs}ms for a free browser slot (max ${maxSessions})`
        : `Max concurrent sessions limit reached (${maxSessions})`
    );
    this.name = 'QueueTimeoutError';
  }
}
