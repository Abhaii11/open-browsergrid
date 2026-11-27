import type { ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFormat = 'json' | 'pretty';
export type StealthPreset = 'auto' | 'macos' | 'windows' | 'linux';

export interface StealthOptions {
  preset?: StealthPreset;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  seed?: number;
}

export interface UserAgentMetadata {
  brands: Array<{ brand: string; version: string }>;
  fullVersionList: Array<{ brand: string; version: string }>;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
}

export interface StealthProfile {
  seed: number;
  preset: Exclude<StealthPreset, 'auto'>;
  userAgent: string;
  platform: string;
  acceptLanguage: string;
  languages: string[];
  locale: string;
  timezone: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
  userAgentMetadata: UserAgentMetadata;
}

export interface GridConfig {
  port: number;
  host: string;
  maxSessions: number;
  sessionTimeoutMs: number;
  apiKey?: string;
  headless: boolean;
  stealth: boolean;
  userDataDirBase?: string;
  profilesDir?: string;
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
  profilesDir: string;
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
  profileId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  stealthOptions?: StealthOptions;
}

export interface BrowserSession {
  id: string;
  profileId?: string;
  persistent: boolean;
  stealthProfile?: StealthProfile;
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
  profileId?: string;
  persistent: boolean;
  createdAt: number;
  uptimeSeconds: number;
  timeoutMs: number;
  status: string;
  url?: string;
  title?: string;
  memoryMb?: number;
  hasClient: boolean;
  metadata: Record<string, string>;
  stealth?: {
    preset: string;
    locale: string;
    timezone: string;
    webglRenderer: string;
  };
  metrics: {
    messagesProxied: number;
    framesReceived: number;
  };
}

export interface ProfileSummary {
  id: string;
  path: string;
  inUse: boolean;
  updatedAt: number;
}

export interface GridStats {
  activeSessions: number;
  launchingSessions: number;
  queuedRequests: number;
  maxSessions: number;
}

export class InvalidSessionIdError extends Error {
  constructor(id: string) {
    super(`Invalid identifier "${id}": must be 1-64 characters matching [a-zA-Z0-9_-]`);
    this.name = 'InvalidSessionIdError';
  }
}

export class ProfileInUseError extends Error {
  constructor(profileId: string) {
    super(`Persistent profile "${profileId}" is currently attached to an active session`);
    this.name = 'ProfileInUseError';
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
