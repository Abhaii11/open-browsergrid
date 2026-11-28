import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { BrowserGridClient, BrowserGridError } from '../../packages/client/src/index.js';
import { resolveSessionUserDataDir, type LaunchResult } from '../../src/browserLauncher.js';
import { createLogger } from '../../src/logger.js';
import { createGridServer } from '../../src/server.js';
import type { GridConfig, ResolvedGridConfig } from '../../src/types.js';

function createMockCdpServer() {
  let cdpPort = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'page-1',
            type: 'page',
            webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/page/1`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      };

      if (msg.method === 'Page.captureScreenshot') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: { data: Buffer.from('fake-png-bytes').toString('base64') },
          })
        );
        return;
      }

      if (msg.method === 'Runtime.evaluate') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: { result: { type: 'string', value: 'Example Domain' } },
          })
        );
        return;
      }

      ws.send(
        JSON.stringify({
          id: msg.id,
          error: { code: -32601, message: 'Method not found' },
        })
      );
    });
  });

  return {
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          cdpPort = (server.address() as AddressInfo).port;
          resolve(cdpPort);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        });
      }),
  };
}

function createStubLauncher(cdpPort: number) {
  return async (
    sessionId: string,
    cfg: ResolvedGridConfig,
    profileId?: string
  ): Promise<LaunchResult> => {
    const resolved = resolveSessionUserDataDir(sessionId, cfg, profileId);
    await fs.promises.mkdir(resolved.userDataDir, { recursive: true });
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    let exitCode: number | null = null;
    Object.defineProperty(child, 'exitCode', { get: () => exitCode });
    Object.defineProperty(child, 'signalCode', { get: () => null });
    child.kill = (() => {
      exitCode = 0;
      setImmediate(() => child.emit('exit', 0, null));
      return true;
    }) as ChildProcess['kill'];

    return {
      process: child,
      wsEndpoint: `ws://127.0.0.1:${cdpPort}/devtools/browser/${sessionId}`,
      cdpPort,
      userDataDir: resolved.userDataDir,
      persistent: resolved.persistent,
    };
  };
}

test('Phase 4: Screenshot, CDP Execute, OpenAPI, Dashboard v2, and SDK Client', async (t) => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bg-phase4-test-'));
  const mockCdp = createMockCdpServer();
  const cdpPort = await mockCdp.start();

  const config: GridConfig = {
    port: 0,
    host: '127.0.0.1',
    maxSessions: 2,
    sessionTimeoutMs: 60_000,
    profilesDir: path.join(tempRoot, 'profiles'),
    userDataDirBase: tempRoot,
    headless: true,
    stealth: true,
    logLevel: 'silent',
  };

  const app = createGridServer(config, {
    launcher: createStubLauncher(cdpPort),
    logger: createLogger({ level: 'silent' }),
  });
  await app.start();
  const port = (app.server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new BrowserGridClient(baseUrl);

  try {
    await t.test('GET /openapi.json serves OpenAPI 3.1 specification', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      assert.strictEqual(res.status, 200);
      const spec = (await res.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      assert.strictEqual(spec.openapi, '3.1.0');
      assert.ok(spec.paths['/health']);
      assert.ok(spec.paths['/api/sessions']);
      assert.ok(spec.paths['/api/sessions/{id}/screenshot']);
      assert.ok(spec.paths['/api/sessions/{id}/execute']);
    });

    await t.test(
      'GET / includes light/dark theme toggle, mobile layout, and API Spec link',
      async () => {
        const res = await fetch(`${baseUrl}/`);
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('toggleTheme'));
        assert.ok(html.includes('[data-theme="light"]'));
        assert.ok(html.includes('@media (max-width: 768px)'));
        assert.ok(html.includes('/openapi.json'));
      }
    );

    await t.test(
      'BrowserGridClient creates session, captures screenshot, executes CDP, and closes',
      async () => {
        const health = await client.health();
        assert.strictEqual(health.status, 'ok');

        const created = await client.createSession({
          id: 'phase4-sdk-test',
          metadata: { env: 'ci' },
        });
        assert.strictEqual(created.id, 'phase4-sdk-test');
        assert.ok(created.wsEndpoint.endsWith('/connect/phase4-sdk-test'));

        const ready = await client.waitForReady('phase4-sdk-test', {
          timeoutMs: 2000,
          intervalMs: 50,
        });
        assert.strictEqual(ready.status, 'ready');

        const sessions = await client.listSessions();
        assert.strictEqual(sessions.length, 1);

        const png = await client.screenshot('phase4-sdk-test');
        assert.ok(png instanceof Uint8Array);
        assert.strictEqual(Buffer.from(png).toString('utf-8'), 'fake-png-bytes');

        const evalRes = await client.execute('phase4-sdk-test', {
          method: 'Runtime.evaluate',
          params: { expression: 'document.title', returnByValue: true },
        });
        assert.deepStrictEqual(evalRes.result, {
          result: { type: 'string', value: 'Example Domain' },
        });

        await assert.rejects(
          () => client.execute('phase4-sdk-test', { method: 'Error.test' }),
          (err: unknown) => err instanceof BrowserGridError && err.statusCode === 503
        );

        const closed = await client.closeSession('phase4-sdk-test');
        assert.ok(closed.message.includes('closed'));
      }
    );

    await t.test(
      'Screenshot and Execute return 404/400 on missing session or invalid payload',
      async () => {
        const missingShot = await fetch(`${baseUrl}/api/sessions/does-not-exist/screenshot`);
        assert.strictEqual(missingShot.status, 404);

        const created = await client.createSession({ id: 'phase4-val-test' });
        assert.strictEqual(created.id, 'phase4-val-test');

        const badExec = await fetch(`${baseUrl}/api/sessions/phase4-val-test/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: {} }),
        });
        assert.strictEqual(badExec.status, 400);

        await client.closeSession('phase4-val-test');
      }
    );
  } finally {
    await app.stop();
    await mockCdp.stop();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
