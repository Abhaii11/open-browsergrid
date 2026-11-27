import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { resolveGridConfig } from './config.js';
import { getDashboardHtml } from './dashboard.js';
import { createLogger, type Logger } from './logger.js';
import { SessionManager, type SessionManagerDeps } from './sessionManager.js';
import {
  InvalidSessionIdError,
  ProfileInUseError,
  QueueFullError,
  QueueTimeoutError,
  type CreateSessionOptions,
  type GridConfig,
  type StealthOptions,
  type StealthPreset,
} from './types.js';

const MAX_BODY_BYTES = 64 * 1024;
const VALID_PRESETS = new Set<StealthPreset>(['auto', 'macos', 'windows', 'linux']);

function parseRequestUrl(rawUrl?: string): URL {
  try {
    return new URL(rawUrl || '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new BadRequestError(`Request body exceeds ${MAX_BODY_BYTES} byte limit`);
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('Invalid JSON request body');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function parseStealthOptionsFromBody(raw: unknown): StealthOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('Field "stealth" must be an options object');
  }
  const obj = raw as Record<string, unknown>;
  const stealth: StealthOptions = {};

  if (obj.preset !== undefined) {
    if (typeof obj.preset !== 'string' || !VALID_PRESETS.has(obj.preset as StealthPreset)) {
      throw new BadRequestError(
        'Field "stealth.preset" must be one of auto | macos | windows | linux'
      );
    }
    stealth.preset = obj.preset as StealthPreset;
  }
  if (obj.userAgent !== undefined) {
    if (typeof obj.userAgent !== 'string' || obj.userAgent.length === 0) {
      throw new BadRequestError('Field "stealth.userAgent" must be a non-empty string');
    }
    stealth.userAgent = obj.userAgent;
  }
  if (obj.locale !== undefined) {
    if (typeof obj.locale !== 'string' || obj.locale.length === 0) {
      throw new BadRequestError('Field "stealth.locale" must be a non-empty string');
    }
    stealth.locale = obj.locale;
  }
  if (obj.timezone !== undefined) {
    if (typeof obj.timezone !== 'string' || obj.timezone.length === 0) {
      throw new BadRequestError('Field "stealth.timezone" must be a non-empty string');
    }
    stealth.timezone = obj.timezone;
  }
  if (obj.seed !== undefined) {
    if (typeof obj.seed !== 'number' || !Number.isInteger(obj.seed) || obj.seed < 0) {
      throw new BadRequestError('Field "stealth.seed" must be a non-negative integer');
    }
    stealth.seed = obj.seed;
  }

  return stealth;
}

function parseSessionOptionsFromBody(body: Record<string, unknown>): CreateSessionOptions {
  const options: CreateSessionOptions = {};

  if (body.id !== undefined) {
    if (typeof body.id !== 'string') {
      throw new BadRequestError('Field "id" must be a string');
    }
    options.id = body.id;
  }

  if (body.profileId !== undefined) {
    if (typeof body.profileId !== 'string') {
      throw new BadRequestError('Field "profileId" must be a string');
    }
    options.profileId = body.profileId;
  }

  if (body.timeoutMs !== undefined) {
    if (
      typeof body.timeoutMs !== 'number' ||
      !Number.isFinite(body.timeoutMs) ||
      body.timeoutMs < 1000
    ) {
      throw new BadRequestError('Field "timeoutMs" must be a number >= 1000');
    }
    options.timeoutMs = Math.floor(body.timeoutMs);
  }

  if (body.stealth !== undefined) {
    options.stealthOptions = parseStealthOptionsFromBody(body.stealth);
  }

  if (body.metadata !== undefined) {
    if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      throw new BadRequestError('Field "metadata" must be a key-value object');
    }
    const entries = Object.entries(body.metadata as Record<string, unknown>);
    if (entries.length > 20) {
      throw new BadRequestError('Field "metadata" supports at most 20 keys');
    }
    const metadata: Record<string, string> = {};
    for (const [key, value] of entries) {
      metadata[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    options.metadata = metadata;
  }

  return options;
}

function parseSessionOptionsFromWs(
  pathname: string,
  parsedUrl: URL,
  headers: http.IncomingHttpHeaders
): CreateSessionOptions {
  const options: CreateSessionOptions = {};

  if (pathname.startsWith('/connect/')) {
    const rawId = pathname.slice('/connect/'.length).split('/')[0];
    if (rawId) {
      options.id = rawId;
    }
  } else {
    const queryId = parsedUrl.searchParams.get('sessionId');
    if (queryId) {
      options.id = queryId;
    }
  }

  const profileId = parsedUrl.searchParams.get('profileId');
  if (profileId) {
    options.profileId = profileId;
  }

  const rawTimeout =
    parsedUrl.searchParams.get('timeoutMs') ??
    (typeof headers['x-session-timeout'] === 'string' ? headers['x-session-timeout'] : undefined);
  if (rawTimeout) {
    const parsed = Number.parseInt(rawTimeout, 10);
    if (!Number.isNaN(parsed) && parsed >= 1000) {
      options.timeoutMs = parsed;
    }
  }

  const stealthOptions: StealthOptions = {};
  const preset = parsedUrl.searchParams.get('preset');
  if (preset && VALID_PRESETS.has(preset as StealthPreset)) {
    stealthOptions.preset = preset as StealthPreset;
  }
  const locale = parsedUrl.searchParams.get('locale');
  if (locale) stealthOptions.locale = locale;
  const timezone = parsedUrl.searchParams.get('timezone');
  if (timezone) stealthOptions.timezone = timezone;
  const userAgent = parsedUrl.searchParams.get('userAgent');
  if (userAgent) stealthOptions.userAgent = userAgent;

  if (Object.keys(stealthOptions).length > 0) {
    options.stealthOptions = stealthOptions;
  }

  const metadata: Record<string, string> = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    if (key.startsWith('tag_') && key.length > 4) {
      metadata[key.slice(4)] = value;
    } else if (key.startsWith('meta_') && key.length > 5) {
      metadata[key.slice(5)] = value;
    }
  }
  if (Object.keys(metadata).length > 0) {
    options.metadata = metadata;
  }

  return options;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export interface GridServerDeps extends SessionManagerDeps {
  sessionManager?: SessionManager;
}

export function createGridServer(userConfig: GridConfig, deps: GridServerDeps = {}) {
  const config = resolveGridConfig(userConfig);
  const logger: Logger =
    deps.logger ??
    createLogger({
      level: config.logLevel,
      format: config.logFormat,
      bindings: { component: 'server' },
    });

  const sessionManager =
    deps.sessionManager ??
    new SessionManager(config, {
      launcher: deps.launcher,
      getMemoryMb: deps.getMemoryMb,
      logger: logger.child({ component: 'sessionManager' }),
    });

  let boundPort = config.port;

  const server = http.createServer(async (req, res) => {
    const parsed = parseRequestUrl(req.url);
    const pathname = parsed.pathname || '/';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (config.apiKey && pathname.startsWith('/api')) {
      const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
      const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/, '') : '';
      if (token !== config.apiKey) {
        sendJson(res, 401, { error: 'Unauthorized: Invalid API key' });
        return;
      }
    }

    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(boundPort));
      return;
    }

    if ((pathname === '/health' || pathname === '/api/health') && req.method === 'GET') {
      const stats = sessionManager.getStats();
      sendJson(res, 200, {
        status: 'ok',
        version: '0.1.0',
        ...stats,
        uptime: process.uptime(),
      });
      return;
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      sendJson(res, 200, sessionManager.getSummaries());
      return;
    }

    if (pathname === '/api/sessions' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const options = parseSessionOptionsFromBody(body);
        const session = await sessionManager.createSession(options);
        sendJson(res, 201, {
          id: session.id,
          profileId: session.profileId,
          persistent: session.persistent,
          wsEndpoint: `ws://${config.host}:${boundPort}/connect/${session.id}`,
          status: session.status,
          createdAt: session.createdAt,
          timeoutMs: session.timeoutMs,
          metadata: session.metadata,
          stealth: session.stealthProfile
            ? {
                preset: session.stealthProfile.preset,
                locale: session.stealthProfile.locale,
                timezone: session.stealthProfile.timezone,
                webglRenderer: session.stealthProfile.webglRenderer,
              }
            : undefined,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof BadRequestError || err instanceof InvalidSessionIdError) {
          sendJson(res, 400, { error: message });
        } else if (err instanceof ProfileInUseError) {
          sendJson(res, 409, { error: message });
        } else if (err instanceof QueueFullError) {
          sendJson(res, 429, { error: message });
        } else if (err instanceof QueueTimeoutError) {
          sendJson(res, 503, { error: message });
        } else {
          logger.error('Failed to create session via API', { err });
          sendJson(res, 500, { error: message });
        }
      }
      return;
    }

    if (pathname.startsWith('/api/sessions/')) {
      const sessionId = pathname.slice('/api/sessions/'.length).split('/')[0];
      if (!sessionId) {
        sendJson(res, 400, { error: 'Missing session ID' });
        return;
      }

      if (req.method === 'GET') {
        const summary = sessionManager.getSessionSummary(sessionId);
        if (summary) {
          sendJson(res, 200, summary);
        } else {
          sendJson(res, 404, { error: `Session ${sessionId} not found` });
        }
        return;
      }

      if (req.method === 'DELETE') {
        const success = await sessionManager.closeSession(sessionId);
        if (success) {
          sendJson(res, 200, { message: `Session ${sessionId} closed` });
        } else {
          sendJson(res, 404, { error: `Session ${sessionId} not found` });
        }
        return;
      }
    }

    if (pathname === '/api/profiles' && req.method === 'GET') {
      const profiles = await sessionManager.listProfiles();
      sendJson(res, 200, profiles);
      return;
    }

    if (pathname.startsWith('/api/profiles/') && req.method === 'DELETE') {
      const profileId = pathname.slice('/api/profiles/'.length).split('/')[0];
      if (!profileId) {
        sendJson(res, 400, { error: 'Missing profile ID' });
        return;
      }
      try {
        const deleted = await sessionManager.deleteProfile(profileId);
        if (deleted) {
          sendJson(res, 200, { message: `Profile ${profileId} deleted` });
        } else {
          sendJson(res, 404, { error: `Profile ${profileId} not found` });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof InvalidSessionIdError) {
          sendJson(res, 400, { error: message });
        } else if (err instanceof ProfileInUseError) {
          sendJson(res, 409, { error: message });
        } else {
          sendJson(res, 500, { error: message });
        }
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const parsed = parseRequestUrl(req.url);
    const pathname = parsed.pathname || '';

    if (config.apiKey) {
      const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
      const queryKey = parsed.searchParams.get('token') || parsed.searchParams.get('apiKey');
      const token =
        (typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/, '') : '') || queryKey;
      if (token !== config.apiKey) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    if (pathname === '/dashboard/ws') {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        sessionManager.registerDashboardSubscriber(clientWs);
      });
      return;
    }

    if (pathname === '/connect' || pathname === '/v1/connect' || pathname.startsWith('/connect/')) {
      const options = parseSessionOptionsFromWs(pathname, parsed, req.headers);

      wss.handleUpgrade(req, socket, head, async (clientWs) => {
        try {
          await sessionManager.attachClient(options, clientWs);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const closeCode =
            err instanceof InvalidSessionIdError
              ? 4400
              : err instanceof ProfileInUseError
                ? 4409
                : err instanceof QueueFullError || err instanceof QueueTimeoutError
                  ? 1013
                  : 1011;
          logger.warn('Failed to attach WebSocket client to session', {
            sessionId: options.id,
            profileId: options.profileId,
            closeCode,
            err,
          });
          if (
            clientWs.readyState === clientWs.OPEN ||
            clientWs.readyState === clientWs.CONNECTING
          ) {
            clientWs.close(closeCode, message.slice(0, 120));
          }
        }
      });
      return;
    }

    socket.destroy();
  });

  return {
    server,
    sessionManager,
    logger,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(config.port, config.host, () => {
          const address = server.address() as AddressInfo | null;
          if (address && typeof address.port === 'number') {
            boundPort = address.port;
          }
          resolve();
        });
      }),
    stop: async () => {
      await sessionManager.shutdown();
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        wss.close(() => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        });
      });
    },
  };
}
