/**
 * @open-browsergrid/client
 * Typed TypeScript client for the OpenBrowserGrid REST API.
 *
 * @example
 * ```ts
 * import { BrowserGridClient } from '@open-browsergrid/client';
 *
 * const grid = new BrowserGridClient('http://localhost:3000');
 * const session = await grid.createSession({ metadata: { task: 'scrape' } });
 * console.log(session.wsEndpoint); // ws://localhost:3000/connect/<id>
 *
 * const png = await grid.screenshot(session.id);
 * // ...
 * await grid.closeSession(session.id);
 * ```
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types (mirror of the server's types.ts, kept minimal for the public API)
// ──────────────────────────────────────────────────────────────────────────────

export type SessionStatus = 'launching' | 'ready' | 'active' | 'closing' | 'closed';

export interface StealthOptions {
  preset?: 'auto' | 'macos' | 'windows' | 'linux';
  userAgent?: string;
  locale?: string;
  timezone?: string;
  seed?: number;
}

export interface CreateSessionOptions {
  /** Named session ID (1–64 chars matching [a-zA-Z0-9_-]). Auto-generated if omitted. */
  id?: string;
  /** Attach a persistent browser profile by ID. */
  profileId?: string;
  /** Session idle timeout in ms (minimum 1000). */
  timeoutMs?: number;
  /** Up to 20 user-defined string tags. */
  metadata?: Record<string, string>;
  /** Stealth/fingerprint options. */
  stealth?: StealthOptions;
}

export interface SessionResult {
  id: string;
  profileId?: string;
  persistent: boolean;
  /** WebSocket CDP endpoint: ws://<host>/connect/<id> */
  wsEndpoint: string;
  status: SessionStatus;
  createdAt: number;
  timeoutMs: number;
  metadata: Record<string, string>;
  stealth?: {
    preset: string;
    locale: string;
    timezone: string;
    webglRenderer: string;
  };
}

export interface SessionSummary {
  id: string;
  profileId?: string;
  persistent: boolean;
  createdAt: number;
  uptimeSeconds: number;
  timeoutMs: number;
  status: SessionStatus;
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

export interface GridHealth {
  status: string;
  version: string;
  activeSessions: number;
  launchingSessions: number;
  queuedRequests: number;
  maxSessions: number;
  uptime: number;
}

export interface ProfileSummary {
  id: string;
  path: string;
  inUse: boolean;
  updatedAt: number;
}

export interface ExecuteOptions {
  /** CDP method name, e.g. "Runtime.evaluate" */
  method: string;
  /** CDP method parameters */
  params?: Record<string, unknown>;
  /** Command timeout in ms (100–30000, default 10000) */
  timeoutMs?: number;
}

export class BrowserGridError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = 'BrowserGridError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────────────────────

export interface BrowserGridClientOptions {
  /** API key / bearer token (if the server was started with --api-key). */
  apiKey?: string;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
}

export class BrowserGridClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  /**
   * Create a new client.
   *
   * @param baseUrl - Server URL, e.g. "http://localhost:3000"
   * @param options - Optional API key and timeout
   */
  constructor(baseUrl: string, options: BrowserGridClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.headers = { 'Content-Type': 'application/json' };
    if (options.apiKey) {
      this.headers['Authorization'] = `Bearer ${options.apiKey}`;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (_e) {
      clearTimeout(timer);
      throw new BrowserGridError(
        `Network error: ${_e instanceof Error ? _e.message : String(_e)}`,
        0,
        ''
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error: string }).error || text;
      } catch {
        /* ignore non-JSON error body */
      }
      throw new BrowserGridError(`HTTP ${res.status}: ${msg}`, res.status, text);
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async requestBinary(path: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });
    } catch (_e) {
      clearTimeout(timer);
      throw new BrowserGridError(
        `Network error: ${_e instanceof Error ? _e.message : String(_e)}`,
        0,
        ''
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error: string }).error || text;
      } catch {
        /* ignore non-JSON error body */
      }
      throw new BrowserGridError(`HTTP ${res.status}: ${msg}`, res.status, text);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  /** Check server health and pool telemetry. */
  async health(): Promise<GridHealth> {
    return this.request<GridHealth>('GET', '/health');
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  /** List all active sessions. */
  async listSessions(): Promise<SessionSummary[]> {
    return this.request<SessionSummary[]>('GET', '/api/sessions');
  }

  /**
   * Create a new browser session and return its details including the WebSocket CDP endpoint.
   *
   * Connect with Playwright:
   * ```ts
   * const browser = await chromium.connectOverCDP(session.wsEndpoint);
   * ```
   */
  async createSession(options: CreateSessionOptions = {}): Promise<SessionResult> {
    return this.request<SessionResult>('POST', '/api/sessions', options);
  }

  /** Get a single session's current detail. */
  async getSession(sessionId: string): Promise<SessionSummary> {
    return this.request<SessionSummary>('GET', `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** Close and terminate a session by ID. */
  async closeSession(sessionId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  /**
   * Capture a PNG screenshot of the session's current page.
   * Returns raw PNG bytes as a `Uint8Array`.
   *
   * @example
   * ```ts
   * import { writeFile } from 'node:fs/promises';
   * const png = await grid.screenshot('my-session');
   * await writeFile('page.png', png);
   * ```
   */
  async screenshot(sessionId: string): Promise<Uint8Array> {
    return this.requestBinary(`/api/sessions/${encodeURIComponent(sessionId)}/screenshot`);
  }

  /**
   * Execute an arbitrary CDP command against a session.
   *
   * @example
   * ```ts
   * const { result } = await grid.execute('my-session', {
   *   method: 'Runtime.evaluate',
   *   params: { expression: 'document.title', returnByValue: true },
   * });
   * ```
   */
  async execute(sessionId: string, options: ExecuteOptions): Promise<{ result: unknown }> {
    return this.request<{ result: unknown }>(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/execute`,
      options
    );
  }

  // ── Profiles ────────────────────────────────────────────────────────────────

  /** List persistent browser profiles. */
  async listProfiles(): Promise<ProfileSummary[]> {
    return this.request<ProfileSummary[]>('GET', '/api/profiles');
  }

  /** Delete a persistent browser profile by ID. */
  async deleteProfile(profileId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      'DELETE',
      `/api/profiles/${encodeURIComponent(profileId)}`
    );
  }

  // ── Convenience ─────────────────────────────────────────────────────────────

  /**
   * Wait for a session to reach `ready` or `active` status.
   * Polls every `intervalMs` ms up to `timeoutMs` ms.
   */
  async waitForReady(
    sessionId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<SessionSummary> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this.getSession(sessionId);
      if (s.status === 'ready' || s.status === 'active') return s;
      if (s.status === 'closing' || s.status === 'closed') {
        throw new BrowserGridError(`Session ${sessionId} closed unexpectedly`, 0, '');
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new BrowserGridError(
      `Session ${sessionId} did not become ready within ${timeoutMs}ms`,
      0,
      ''
    );
  }
}
