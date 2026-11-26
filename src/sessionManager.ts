import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { launchBrowserSession } from './browserLauncher.js';
import { setupCdpProxy } from './cdpProxy.js';
import type { BrowserSession, GridConfig, SessionSummary } from './types.js';

export class SessionManager {
  private sessions = new Map<string, BrowserSession>();
  private dashboardSubscribers = new Set<WebSocket>();
  private reapTimer: NodeJS.Timeout;

  constructor(private config: GridConfig) {
    // Run cleanup check every 10 seconds
    this.reapTimer = setInterval(() => this.reapIdleSessions(), 10000);
    this.reapTimer.unref();
  }

  public async createSession(customId?: string): Promise<BrowserSession> {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(`Max concurrent sessions limit reached (${this.config.maxSessions})`);
    }

    const id = customId || randomUUID().slice(0, 8);
    if (this.sessions.has(id)) {
      return this.sessions.get(id)!;
    }

    const launchResult = await launchBrowserSession(id, this.config);

    const session: BrowserSession = {
      id,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      process: launchResult.process,
      wsEndpoint: launchResult.wsEndpoint,
      cdpPort: launchResult.cdpPort,
      userDataDir: launchResult.userDataDir,
      status: 'ready',
      metrics: {
        messagesProxied: 0,
        framesReceived: 0,
      },
    };

    this.sessions.set(id, session);
    this.broadcastSessionUpdate();
    return session;
  }

  public async attachClient(sessionId: string, clientWs: WebSocket): Promise<BrowserSession> {
    let session = this.sessions.get(sessionId);
    if (!session || session.status === 'closed') {
      session = await this.createSession(sessionId);
    }

    await setupCdpProxy(clientWs, session, this.config, (sessId, frameBase64) => {
      this.broadcastFrame(sessId, frameBase64);
    });

    this.broadcastSessionUpdate();
    return session;
  }

  public getSession(id: string): BrowserSession | undefined {
    return this.sessions.get(id);
  }

  public getAllSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  public getSummaries(): SessionSummary[] {
    const now = Date.now();
    return this.getAllSessions().map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      uptimeSeconds: Math.floor((now - s.createdAt) / 1000),
      status: s.status,
      url: s.url,
      title: s.title,
      hasClient: !!s.clientWs,
      metrics: s.metrics,
    }));
  }

  public async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.status = 'closing';
    try {
      session.clientWs?.close(1000, 'Session terminated');
      session.browserWs?.close(1000, 'Session terminated');
      session.process.kill('SIGTERM');
      setTimeout(() => {
        try {
          session.process.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 1000);
    } catch {
      // ignore
    }

    // Clean up temporary user data dir
    try {
      if (fs.existsSync(session.userDataDir)) {
        fs.rmSync(session.userDataDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    this.sessions.delete(id);
    this.broadcastSessionUpdate();
    return true;
  }

  public registerDashboardSubscriber(ws: WebSocket): void {
    this.dashboardSubscribers.add(ws);
    // Send immediate initial state
    ws.send(
      JSON.stringify({
        type: 'sessions',
        sessions: this.getSummaries(),
      })
    );

    ws.on('close', () => {
      this.dashboardSubscribers.delete(ws);
    });
  }

  private broadcastSessionUpdate(): void {
    if (this.dashboardSubscribers.size === 0) return;
    const msg = JSON.stringify({
      type: 'sessions',
      sessions: this.getSummaries(),
    });
    for (const ws of this.dashboardSubscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  private broadcastFrame(sessionId: string, frameBase64: string): void {
    if (this.dashboardSubscribers.size === 0) return;
    const msg = JSON.stringify({
      type: 'frame',
      sessionId,
      frame: frameBase64,
    });
    for (const ws of this.dashboardSubscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  private reapIdleSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      // If no active client and last active exceeded sessionTimeoutMs
      if (!session.clientWs && now - session.lastActiveAt > this.config.sessionTimeoutMs) {
        this.closeSession(id);
      }
    }
  }

  public async shutdown(): Promise<void> {
    clearInterval(this.reapTimer);
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }
}
