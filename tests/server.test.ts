import test from 'node:test';
import assert from 'node:assert';
import { createGridServer } from '../src/server.js';
import type { GridConfig } from '../src/types.js';

test('OpenBrowserGrid HTTP Server Endpoints', async (t) => {
  const config: GridConfig = {
    port: 3999,
    host: '127.0.0.1',
    maxSessions: 5,
    sessionTimeoutMs: 60000,
    headless: true,
    stealth: true,
  };

  const app = createGridServer(config);
  await app.start();

  await t.test('GET /health returns 200 and json status', async () => {
    const res = await fetch('http://127.0.0.1:3999/health');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.version, '0.1.0');
    assert.strictEqual(data.maxSessions, 5);
  });

  await t.test('GET / returns 200 and dashboard HTML', async () => {
    const res = await fetch('http://127.0.0.1:3999/');
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('OpenBrowserGrid'));
    assert.ok(text.includes('Active Sessions'));
  });

  await t.test('GET /api/sessions returns empty array initially', async () => {
    const res = await fetch('http://127.0.0.1:3999/api/sessions');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 0);
  });

  await app.stop();
});
