import type { ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';

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
}

export interface BrowserSession {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  process: ChildProcess;
  wsEndpoint: string;
  cdpPort: number;
  clientWs?: WebSocket;
  browserWs?: WebSocket;
  userDataDir: string;
  latestScreenshot?: string; // base64 JPEG
  url?: string;
  title?: string;
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
  status: string;
  url?: string;
  title?: string;
  hasClient: boolean;
  metrics: {
    messagesProxied: number;
    framesReceived: number;
  };
}
