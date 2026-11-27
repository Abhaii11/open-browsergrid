import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { setupCdpProxy } from '../../src/cdpProxy.js';
import type { BrowserSession } from '../../src/types.js';

function createStubSession(wsEndpoint: string): BrowserSession {
  return {
    id: 'hb-test',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    timeoutMs: 60000,
    metadata: {},
    process: new EventEmitter() as ChildProcess,
    wsEndpoint,
    cdpPort: 0,
    userDataDir: '',
    status: 'ready',
    metrics: {
      messagesProxied: 0,
      framesReceived: 0,
    },
  };
}

test('setupCdpProxy terminates unresponsive client when heartbeat pong is missed', async () => {
  const mockBrowserWss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const clientServerWss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let rawClient: WebSocket | undefined;

  try {
    await Promise.all([
      new Promise<void>((resolve) => mockBrowserWss.once('listening', resolve)),
      new Promise<void>((resolve) => clientServerWss.once('listening', resolve)),
    ]);

    const browserPort = (mockBrowserWss.address() as AddressInfo).port;
    const clientServerPort = (clientServerWss.address() as AddressInfo).port;

    const raw = new WebSocket(`ws://127.0.0.1:${clientServerPort}`);
    rawClient = raw;

    const serverSideClientWs = await new Promise<WebSocket>((resolve, reject) => {
      raw.once('error', reject);
      clientServerWss.once('connection', (ws) => {
        raw.removeListener('error', reject);
        raw.on('error', () => {
          // Ignore ECONNRESET when server force-terminates client socket during heartbeat eviction
        });
        resolve(ws);
      });
    });

    let pingCount = 0;
    let terminated = false;
    serverSideClientWs.ping = (() => {
      pingCount++;
    }) as WebSocket['ping'];
    const origTerminate = serverSideClientWs.terminate.bind(serverSideClientWs);
    serverSideClientWs.terminate = () => {
      terminated = true;
      origTerminate();
    };

    const session = createStubSession(`ws://127.0.0.1:${browserPort}`);
    await setupCdpProxy(
      serverSideClientWs,
      session,
      { stealth: false, heartbeatIntervalMs: 25 },
      {}
    );

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Expected missed heartbeat termination')),
        1000
      );
      const check = setInterval(() => {
        if (terminated) {
          clearInterval(check);
          clearTimeout(deadline);
          resolve();
        }
      }, 10);
    });

    assert.ok(pingCount >= 1);
    assert.strictEqual(terminated, true);
  } finally {
    rawClient?.terminate();
    for (const client of mockBrowserWss.clients) {
      client.terminate();
    }
    await Promise.all([
      new Promise<void>((resolve) => clientServerWss.close(() => resolve())),
      new Promise<void>((resolve) => mockBrowserWss.close(() => resolve())),
    ]);
  }
});
