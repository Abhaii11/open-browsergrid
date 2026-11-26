import test from 'node:test';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createGridServer } from '../src/server.js';
import type { GridConfig } from '../src/types.js';

test('OpenBrowserGrid HTTP Server Endpoints', async (t) => {
  const config: GridConfig = {
    port: 0,
    host: '127.0.0.1',
    maxSessions: 5,
    sessionTimeoutMs: 60000,
    headless: true,
    stealth: true,
  };

  const app = createGridServer(config);
  await app.start();
  const port = (app.server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  await t.test('GET /health returns 200 and json status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.version, '0.1.0');
    assert.strictEqual(data.maxSessions, 5);
  });

  await t.test('GET / returns 200 and dashboard HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('OpenBrowserGrid'));
    assert.ok(text.includes('Active Sessions'));
  });

  await t.test('GET /api/sessions returns empty array initially', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 0);
  });

  await t.test('GET /unknown returns 404 json error', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
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
  };

  const app = createGridServer(config);
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
