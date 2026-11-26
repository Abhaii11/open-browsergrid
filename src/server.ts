import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { getDashboardHtml } from './dashboard.js';
import { SessionManager } from './sessionManager.js';
import type { GridConfig } from './types.js';

function parseRequestUrl(rawUrl?: string): URL {
  try {
    return new URL(rawUrl || '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

export function createGridServer(config: GridConfig) {
  const sessionManager = new SessionManager(config);
  let boundPort = config.port;

  const server = http.createServer(async (req, res) => {
    const parsed = parseRequestUrl(req.url);
    const pathname = parsed.pathname || '/';

    // CORS headers for API access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check for API routes if apiKey is configured
    if (config.apiKey && pathname.startsWith('/api')) {
      const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
      const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/, '') : '';
      if (token !== config.apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid API key' }));
        return;
      }
    }

    // Dashboard UI
    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(boundPort));
      return;
    }

    // Health check
    if (pathname === '/health' || pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          version: '0.1.0',
          activeSessions: sessionManager.getAllSessions().length,
          maxSessions: config.maxSessions,
          uptime: process.uptime(),
        })
      );
      return;
    }

    // List sessions
    if (pathname === '/api/sessions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessionManager.getSummaries()));
      return;
    }

    // Create session via REST API
    if (pathname === '/api/sessions' && req.method === 'POST') {
      try {
        const session = await sessionManager.createSession();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: session.id,
            wsEndpoint: `ws://${config.host}:${boundPort}/connect/${session.id}`,
            status: session.status,
            createdAt: session.createdAt,
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    // Terminate session
    if (pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
      const sessionId = pathname.replace('/api/sessions/', '').split('/')[0];
      const success = await sessionManager.closeSession(sessionId);
      if (success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Session ${sessionId} closed` }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Session ${sessionId} not found` }));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // Setup WebSocket server for both CDP connections and Dashboard
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const parsed = parseRequestUrl(req.url);
    const pathname = parsed.pathname || '';

    // Auth check on upgrade
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

    // Dashboard WebSocket
    if (pathname === '/dashboard/ws') {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        sessionManager.registerDashboardSubscriber(clientWs);
      });
      return;
    }

    // CDP Client Connection: /connect, /v1/connect, or /connect/:id
    if (pathname === '/connect' || pathname === '/v1/connect' || pathname.startsWith('/connect/')) {
      wss.handleUpgrade(req, socket, head, async (clientWs) => {
        let requestedId: string | undefined;
        if (pathname.startsWith('/connect/')) {
          requestedId = pathname.replace('/connect/', '').split('/')[0];
        }

        try {
          await sessionManager.attachClient(requestedId || '', clientWs);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          clientWs.close(1011, `Failed to attach session: ${message}`);
        }
      });
      return;
    }

    // Unrecognized websocket endpoint
    socket.destroy();
  });

  return {
    server,
    sessionManager,
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
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
