import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { LaunchResult } from '../../src/browserLauncher.js';
import { createLogger } from '../../src/logger.js';
import { createGridServer } from '../../src/server.js';
import type { GridConfig } from '../../src/types.js';

function createStubLauncher() {
  return async (sessionId: string): Promise<LaunchResult> => {
    const userDataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `bg-http-test-${sessionId}-`)
    );
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
      wsEndpoint: `ws://127.0.0.1:9999/devtools/browser/${sessionId}`,
      cdpPort: 9999,
      userDataDir,
    };
  };
}

test('OpenBrowserGrid HTTP Server Endpoints & Session Lifecycle', async (t) => {
  const config: GridConfig = {
    port: 0,
    host: '127.0.0.1',
    maxSessions: 1,
    maxQueueSize: 0,
    queueTimeoutMs: 100,
    sessionTimeoutMs: 60000,
    headless: true,
    stealth: true,
    logLevel: 'silent',
  };

  const app = createGridServer(config, {
    launcher: createStubLauncher(),
    logger: createLogger({ level: 'silent' }),
  });
  await app.start();
  const port = (app.server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  await t.test('GET /health returns 200 and pool telemetry', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.version, '0.1.0');
    assert.strictEqual(data.maxSessions, 1);
    assert.strictEqual(data.activeSessions, 0);
    assert.strictEqual(data.queuedRequests, 0);
  });

  await t.test('GET / returns 200 and dashboard HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('OpenBrowserGrid'));
    assert.ok(text.includes('Active Sessions'));
  });

  await t.test('POST /api/sessions rejects invalid JSON and invalid session IDs', async () => {
    const badJson = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.strictEqual(badJson.status, 400);

    const badId = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '../traversal' }),
    });
    assert.strictEqual(badId.status, 400);
  });

  await t.test(
    'POST, GET, and DELETE /api/sessions manage named session with metadata',
    async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ci-agent-1',
          timeoutMs: 120000,
          metadata: { env: 'ci', workflow: 'smoke' },
        }),
      });
      assert.strictEqual(createRes.status, 201);
      const created = (await createRes.json()) as Record<string, unknown>;
      assert.strictEqual(created.id, 'ci-agent-1');
      assert.strictEqual(created.wsEndpoint, `ws://127.0.0.1:${port}/connect/ci-agent-1`);
      assert.deepStrictEqual(created.metadata, { env: 'ci', workflow: 'smoke' });

      const getRes = await fetch(`${baseUrl}/api/sessions/ci-agent-1`);
      assert.strictEqual(getRes.status, 200);
      const summary = (await getRes.json()) as Record<string, unknown>;
      assert.strictEqual(summary.id, 'ci-agent-1');
      assert.strictEqual(summary.timeoutMs, 120000);

      // Queue limit = 0 so concurrent overflow returns 429
      const overflowRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ci-agent-2' }),
      });
      assert.strictEqual(overflowRes.status, 429);

      const delRes = await fetch(`${baseUrl}/api/sessions/ci-agent-1`, { method: 'DELETE' });
      assert.strictEqual(delRes.status, 200);

      const missingRes = await fetch(`${baseUrl}/api/sessions/ci-agent-1`);
      assert.strictEqual(missingRes.status, 404);
    }
  );

  await t.test('GET /unknown returns 404 json error', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.strictEqual(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.strictEqual(data.error, 'Not found');
  });

  await app.stop();
});

test('OpenBrowserGrid API Key Authentication', async (t) => {
  const config: GridConfig = {
    port: 0,
    host: '127.0.0.1',
    maxSessions: 2,
    sessionTimeoutMs: 60000,
    apiKey: 'secret-test-key',
    headless: true,
    stealth: true,
    logLevel: 'silent',
  };

  const app = createGridServer(config, {
    launcher: createStubLauncher(),
    logger: createLogger({ level: 'silent' }),
  });
  await app.start();
  const port = (app.server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  await t.test('rejects unauthenticated /api/sessions request', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.strictEqual(res.status, 401);
  });

  await t.test('accepts Bearer token in Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer secret-test-key' },
    });
    assert.strictEqual(res.status, 200);
  });

  await app.stop();
});
