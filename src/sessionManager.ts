import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  cleanupUserDataDir,
  deletePersistentProfile,
  getProcessMemoryMb,
  launchBrowserSession,
  listPersistentProfiles,
  terminateProcess,
  validateSessionId,
  type SessionLauncher,
} from './browserLauncher.js';
import { createClientMessageBuffer, setupCdpProxy } from './cdpProxy.js';
import { resolveGridConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { resolveStealthProfile } from './stealth.js';
import {
  ProfileInUseError,
  QueueFullError,
  QueueTimeoutError,
  type BrowserSession,
  type CreateSessionOptions,
  type GridConfig,
  type GridStats,
  type ProfileSummary,
  type ResolvedGridConfig,
  type SessionSummary,
} from './types.js';

interface QueueWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface SessionManagerDeps {
  launcher?: SessionLauncher;
  logger?: Logger;
  getMemoryMb?: (pid: number | undefined) => Promise<number | undefined>;
}

export class SessionManager {
  private readonly config: ResolvedGridConfig;
  private readonly logger: Logger;
  private readonly launcher: SessionLauncher;
  private readonly getMemoryMb: (pid: number | undefined) => Promise<number | undefined>;

  private sessions = new Map<string, BrowserSession>();
  private inFlightById = new Map<string, Promise<BrowserSession>>();
  private activeProfileIds = new Set<string>();
  private pendingLaunches = 0;
  private waitQueue: QueueWaiter[] = [];
  private dashboardSubscribers = new Set<WebSocket>();
  private watchdogTimer: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(config: GridConfig, deps: SessionManagerDeps = {}) {
    this.config = resolveGridConfig(config);
    this.logger =
      deps.logger ??
      createLogger({
        level: this.config.logLevel,
        format: this.config.logFormat,
        bindings: { component: 'sessionManager' },
      });
    this.launcher =
      deps.launcher ??
      ((id, cfg, profileId) =>
        launchBrowserSession(id, cfg, this.logger.child({ sessionId: id }), profileId));
    this.getMemoryMb = deps.getMemoryMb ?? getProcessMemoryMb;

    this.watchdogTimer = setInterval(() => {
      void this.runWatchdog();
    }, this.config.watchdogIntervalMs);
    this.watchdogTimer.unref();
  }

  public getStats(): GridStats {
    return {
      activeSessions: this.sessions.size,
      launchingSessions: this.pendingLaunches,
      queuedRequests: this.waitQueue.length,
      maxSessions: this.config.maxSessions,
    };
  }

  public async createSession(optionsOrId?: string | CreateSessionOptions): Promise<BrowserSession> {
    if (this.shuttingDown) {
      throw new Error('Server is shutting down');
    }

    const options: CreateSessionOptions =
      typeof optionsOrId === 'string' ? { id: optionsOrId } : (optionsOrId ?? {});

    const id = options.id ? validateSessionId(options.id) : randomUUID().slice(0, 8);
    const profileId = options.profileId ? validateSessionId(options.profileId) : undefined;

    const existing = this.sessions.get(id);
    if (existing && existing.status !== 'closing' && existing.status !== 'closed') {
      if (profileId && existing.profileId !== profileId) {
        throw new ProfileInUseError(profileId);
      }
      return existing;
    }

    const inFlight = this.inFlightById.get(id);
    if (inFlight) {
      return inFlight;
    }

    if (profileId) {
      if (this.activeProfileIds.has(profileId)) {
        throw new ProfileInUseError(profileId);
      }
      this.activeProfileIds.add(profileId);
    }

    const createPromise = this.launchWithSlotReservation(id, options, profileId);
    this.inFlightById.set(id, createPromise);

    try {
      return await createPromise;
    } catch (err) {
      if (profileId) {
        this.activeProfileIds.delete(profileId);
      }
      throw err;
    } finally {
      this.inFlightById.delete(id);
    }
  }

  private async launchWithSlotReservation(
    id: string,
    options: CreateSessionOptions,
    profileId?: string
  ): Promise<BrowserSession> {
    await this.acquireSlot();

    let transferredToSession = false;
    try {
      const launchResult = await this.launcher(id, this.config, profileId);
      const persistent = launchResult.persistent ?? Boolean(profileId);
      const timeoutMs =
        options.timeoutMs && options.timeoutMs >= 1000
          ? options.timeoutMs
          : this.config.sessionTimeoutMs;

      const stealthProfile = this.config.stealth
        ? resolveStealthProfile(profileId || id, options.stealthOptions)
        : undefined;

      const session: BrowserSession = {
        id,
        profileId,
        persistent,
        stealthProfile,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        timeoutMs,
        metadata: options.metadata ? { ...options.metadata } : {},
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

      this.attachCrashHandler(session);

      // Register in sessions BEFORE releasing pendingLaunches so capacity invariant holds
      this.sessions.set(id, session);
      this.pendingLaunches = Math.max(0, this.pendingLaunches - 1);
      transferredToSession = true;

      this.logger.info('Browser session created', {
        sessionId: id,
        profileId,
        persistent,
        stealthPreset: stealthProfile?.preset,
        cdpPort: session.cdpPort,
        timeoutMs: session.timeoutMs,
        metadata: session.metadata,
      });

      this.broadcastSessionUpdate();
      return session;
    } finally {
      if (!transferredToSession) {
        this.pendingLaunches = Math.max(0, this.pendingLaunches - 1);
        this.drainQueue();
      }
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.sessions.size + this.pendingLaunches < this.config.maxSessions) {
      this.pendingLaunches++;
      return Promise.resolve();
    }

    const queueTimeoutMs = this.config.queueTimeoutMs;
    if (queueTimeoutMs <= 0) {
      return Promise.reject(new QueueTimeoutError(this.config.maxSessions, 0));
    }

    if (this.waitQueue.length >= this.config.maxQueueSize) {
      return Promise.reject(new QueueFullError(this.config.maxQueueSize));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.waitQueue.indexOf(waiter);
          if (idx !== -1) {
            this.waitQueue.splice(idx, 1);
          }
          reject(new QueueTimeoutError(this.config.maxSessions, queueTimeoutMs));
        }, queueTimeoutMs),
      };
      waiter.timer.unref();
      this.waitQueue.push(waiter);
      this.logger.debug('Queued session request', { queueLength: this.waitQueue.length });
    });
  }

  private drainQueue(): void {
    while (
      this.waitQueue.length > 0 &&
      this.sessions.size + this.pendingLaunches < this.config.maxSessions &&
      !this.shuttingDown
    ) {
      const next = this.waitQueue.shift();
      if (next) {
        clearTimeout(next.timer);
        this.pendingLaunches++;
        next.resolve();
      }
    }
  }

  private attachCrashHandler(session: BrowserSession): void {
    session.process.once('exit', (code, signal) => {
      if (session.status === 'closing' || session.status === 'closed') {
        return;
      }

      this.logger.error('Browser process exited unexpectedly', {
        sessionId: session.id,
        profileId: session.profileId,
        code,
        signal,
      });

      session.status = 'closed';
      session.proxyTeardown?.();

      if (session.clientWs && session.clientWs.readyState === session.clientWs.OPEN) {
        session.clientWs.close(1011, 'Browser process crashed');
      }

      this.sessions.delete(session.id);
      if (session.profileId) {
        this.activeProfileIds.delete(session.profileId);
      }
      if (!session.persistent) {
        void cleanupUserDataDir(session.userDataDir, this.logger);
      }
      this.drainQueue();
      this.broadcastSessionUpdate();
    });
  }

  public async attachClient(
    sessionIdOrOptions: string | CreateSessionOptions,
    clientWs: WebSocket
  ): Promise<BrowserSession> {
    const options: CreateSessionOptions =
      typeof sessionIdOrOptions === 'string'
        ? { id: sessionIdOrOptions || undefined }
        : sessionIdOrOptions;

    const buffer = createClientMessageBuffer(clientWs);

    try {
      const session = await this.createSession(options);

      if (options.metadata && Object.keys(options.metadata).length > 0) {
        session.metadata = { ...session.metadata, ...options.metadata };
      }

      const initialMessages = buffer.drain();
      await setupCdpProxy(
        clientWs,
        session,
        this.config,
        {
          onFrameUpdate: (sessId, frameBase64) => {
            this.broadcastFrame(sessId, frameBase64);
          },
          onSessionUpdate: () => {
            this.broadcastSessionUpdate();
          },
        },
        initialMessages,
        this.logger
      );

      this.broadcastSessionUpdate();
      return session;
    } catch (err) {
      buffer.dispose();
      throw err;
    }
  }

  public getSession(id: string): BrowserSession | undefined {
    return this.sessions.get(id);
  }

  public getAllSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  public getSummaries(): SessionSummary[] {
    const now = Date.now();
    return this.getAllSessions().map((s) => this.summarizeSession(s, now));
  }

  public getSessionSummary(id: string): SessionSummary | undefined {
    const session = this.sessions.get(id);
    return session ? this.summarizeSession(session, Date.now()) : undefined;
  }

  private summarizeSession(s: BrowserSession, now: number): SessionSummary {
    return {
      id: s.id,
      profileId: s.profileId,
      persistent: s.persistent,
      createdAt: s.createdAt,
      uptimeSeconds: Math.floor((now - s.createdAt) / 1000),
      timeoutMs: s.timeoutMs,
      status: s.status,
      url: s.url,
      title: s.title,
      memoryMb: s.memoryMb,
      hasClient: !!s.clientWs,
      metadata: s.metadata,
      stealth: s.stealthProfile
        ? {
            preset: s.stealthProfile.preset,
            locale: s.stealthProfile.locale,
            timezone: s.stealthProfile.timezone,
            webglRenderer: s.stealthProfile.webglRenderer,
          }
        : undefined,
      metrics: s.metrics,
    };
  }

  public async listProfiles(): Promise<ProfileSummary[]> {
    return listPersistentProfiles(this.config.profilesDir, this.activeProfileIds);
  }

  public async deleteProfile(profileId: string): Promise<boolean> {
    const safeId = validateSessionId(profileId);
    if (this.activeProfileIds.has(safeId)) {
      throw new ProfileInUseError(safeId);
    }
    return deletePersistentProfile(this.config.profilesDir, safeId);
  }

  public async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.status === 'closing' || session.status === 'closed') {
      return true;
    }

    session.status = 'closing';
    session.proxyTeardown?.();

    if (session.clientWs && session.clientWs.readyState === session.clientWs.OPEN) {
      session.clientWs.close(1000, 'Session terminated');
    }

    await terminateProcess(session.process);
    session.status = 'closed';
    this.sessions.delete(id);
    if (session.profileId) {
      this.activeProfileIds.delete(session.profileId);
    }

    if (!session.persistent) {
      await cleanupUserDataDir(session.userDataDir, this.logger);
    }

    this.logger.info('Browser session closed', { sessionId: id, persistent: session.persistent });
    this.drainQueue();
    this.broadcastSessionUpdate();
    return true;
  }

  public registerDashboardSubscriber(ws: WebSocket): void {
    this.dashboardSubscribers.add(ws);
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

  public async runWatchdog(): Promise<void> {
    const now = Date.now();
    const toClose: string[] = [];

    for (const [id, session] of this.sessions.entries()) {
      if (session.status === 'closing' || session.status === 'closed') {
        continue;
      }

      if (!session.clientWs && now - session.lastActiveAt > session.timeoutMs) {
        this.logger.info('Reaping idle browser session', {
          sessionId: id,
          idleMs: now - session.lastActiveAt,
          timeoutMs: session.timeoutMs,
        });
        toClose.push(id);
        continue;
      }

      if (this.config.maxSessionMemoryMb > 0) {
        const memoryMb = await this.getMemoryMb(session.process.pid);
        if (memoryMb !== undefined) {
          session.memoryMb = memoryMb;
          if (memoryMb > this.config.maxSessionMemoryMb) {
            this.logger.warn('Terminating session exceeding memory limit', {
              sessionId: id,
              memoryMb,
              maxSessionMemoryMb: this.config.maxSessionMemoryMb,
            });
            toClose.push(id);
          }
        }
      }
    }

    if (toClose.length > 0) {
      await Promise.all(toClose.map((id) => this.closeSession(id)));
    }
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.watchdogTimer);

    while (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Server is shutting down'));
      }
    }

    for (const ws of this.dashboardSubscribers) {
      ws.close(1001, 'Server shutting down');
    }
    this.dashboardSubscribers.clear();

    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }
}
