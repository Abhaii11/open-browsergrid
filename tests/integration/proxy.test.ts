import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import WebSocket, { WebSocketServer } from 'ws';
import type { LaunchResult } from '../../src/browserLauncher.js';
import { createLogger } from '../../src/logger.js';
import { createGridServer } from '../../src/server.js';

interface CdpCommand {
  id: number;
  sessionId?: string;
  method: string;
  params?: Record<string, unknown>;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('End-to-end WebSocket CDP Proxy buffers early messages, injects stealth, streams frames, and supports re-attach', async () => {
  // Start a lightweight mock Chromium DevTools WebSocket server
  const receivedCommands: CdpCommand[] = [];
  let browserConnectionCount = 0;

  const mockBrowserWss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => mockBrowserWss.once('listening', resolve));
  const mockBrowserPort = (mockBrowserWss.address() as AddressInfo).port;

  mockBrowserWss.on('connection', (ws) => {
    browserConnectionCount++;

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as CdpCommand;
      receivedCommands.push(msg);

      if (msg.method === 'Browser.getVersion') {
        ws.send(JSON.stringify({ id: msg.id, result: { product: 'MockChrome/130' } }));
      }

      if (msg.method === 'Target.setDiscoverTargets') {
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
        // Simulate page target attachment right after target discovery is enabled
        ws.send(
          JSON.stringify({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: 'page-session-1',
              targetInfo: {
                targetId: 'target-1',
                type: 'page',
                url: 'https://example.com',
                title: 'Example Domain',
              },
            },
          })
        );
      }

      if (msg.method === 'Page.startScreencast') {
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
        ws.send(
          JSON.stringify({
            method: 'Page.screencastFrame',
            params: {
              data: 'ZmFrZS1qcGVnLWZyYW1l',
              sessionId: 42,
            },
          })
        );
      }
    });
  });

  const app = createGridServer(
    {
      port: 0,
      host: '127.0.0.1',
      maxSessions: 2,
      sessionTimeoutMs: 60000,
      heartbeatIntervalMs: 0,
      headless: true,
      stealth: true,
      logLevel: 'silent',
    },
    {
      logger: createLogger({ level: 'silent' }),
      launcher: async (sessionId: string): Promise<LaunchResult> => {
        // Delay launch slightly so client sends its first message while Chromium is starting
        await new Promise((r) => setTimeout(r, 40));
        const userDataDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), `bg-proxy-test-${sessionId}-`)
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
          wsEndpoint: `ws://127.0.0.1:${mockBrowserPort}/devtools/browser/${sessionId}`,
          cdpPort: mockBrowserPort,
          userDataDir,
        };
      },
    }
  );

  await app.start();
  const gridPort = (app.server.address() as AddressInfo).port;

  const waitForOpen = (ws: WebSocket) =>
    new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

  let dashboardWs: WebSocket | undefined;
  let client1: WebSocket | undefined;
  let client2: WebSocket | undefined;

  try {
    // Subscribe a dashboard viewer WebSocket
    const dashboardEvents: Array<{ type: string; frame?: string; sessionId?: string }> = [];
    dashboardWs = new WebSocket(`ws://127.0.0.1:${gridPort}/dashboard/ws`);
    await waitForOpen(dashboardWs);
    dashboardWs.on('message', (data) => {
      dashboardEvents.push(JSON.parse(data.toString('utf-8')));
    });

    // Connect Client #1 to named session with query metadata and stealth preset params
    client1 = new WebSocket(
      `ws://127.0.0.1:${gridPort}/connect/reusable-agent?tag_owner=ci&preset=windows&locale=en-GB&timezone=Europe/London`
    );
    await waitForOpen(client1);

    const client1Messages: Array<{ id?: number; result?: Record<string, unknown> }> = [];
    client1.on('message', (raw) => {
      client1Messages.push(JSON.parse(raw.toString('utf-8')));
    });

    // Send early command immediately before 40ms browser launch finishes
    client1.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));

    // Wait for early message response, stealth injection, screencast ack, and dashboard frame
    await waitUntil(() => {
      const gotVersion = client1Messages.some((m) => m.id === 1);
      const gotAck = receivedCommands.some((c) => c.method === 'Page.screencastFrameAck');
      const gotFrame = dashboardEvents.some(
        (e) => e.type === 'frame' && e.frame === 'ZmFrZS1qcGVnLWZyYW1l'
      );
      return gotVersion && gotAck && gotFrame;
    }, 3000);

    const stealthCmd = receivedCommands.find(
      (c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'
    );
    const uaCmd = receivedCommands.find((c) => c.method === 'Emulation.setUserAgentOverride');
    const tzCmd = receivedCommands.find((c) => c.method === 'Emulation.setTimezoneOverride');
    const localeCmd = receivedCommands.find((c) => c.method === 'Emulation.setLocaleOverride');

    assert.ok(stealthCmd, 'stealth script should be injected on attached page target');
    assert.ok(
      uaCmd?.params?.platform === 'Win32',
      'should override UA platform for windows preset'
    );
    assert.strictEqual(tzCmd?.params?.timezoneId, 'Europe/London');
    assert.strictEqual(localeCmd?.params?.locale, 'en-GB');
    assert.strictEqual(app.sessionManager.getSession('reusable-agent')?.metadata.owner, 'ci');
    assert.strictEqual(
      client1Messages.some((m) => typeof m.id === 'number' && m.id >= 900_000_000),
      false,
      'proxy-internal CDP command responses must never leak to automation client'
    );
    assert.strictEqual(
      client1Messages.some((m) => (m as { method?: string }).method === 'Page.screencastFrame'),
      false,
      'unsolicited Page.screencastFrame events must not be forwarded to client'
    );

    // Disconnect Client #1 and verify named session transitions back to ready cleanly
    client1.close();
    await waitUntil(() => app.sessionManager.getSession('reusable-agent')?.status === 'ready');

    client2 = new WebSocket(`ws://127.0.0.1:${gridPort}/connect/reusable-agent`);
    await waitForOpen(client2);
    const replyPromise = new Promise<{ id: number; result: { product: string } }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for client2 CDP reply')),
          3000
        );
        client2!.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString('utf-8')) as {
            id?: number;
            result?: { product: string };
          };
          if (parsed.id === 2 && parsed.result) {
            clearTimeout(timer);
            resolve({ id: parsed.id, result: parsed.result });
          }
        });
      }
    );
    client2.send(JSON.stringify({ id: 2, method: 'Browser.getVersion' }));
    const reply2 = await replyPromise;
    assert.strictEqual(reply2.result.product, 'MockChrome/130');
    assert.strictEqual(browserConnectionCount, 2);
  } finally {
    client1?.terminate();
    client2?.terminate();
    dashboardWs?.terminate();
    await app.stop();
    for (const client of mockBrowserWss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => mockBrowserWss.close(() => resolve()));
  }
});
