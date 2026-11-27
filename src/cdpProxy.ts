import WebSocket from 'ws';
import type { Logger } from './logger.js';
import { STEALTH_INJECTION_SCRIPT } from './stealth.js';
import type { BrowserSession, ResolvedGridConfig } from './types.js';

export interface BufferedWsMessage {
  data: WebSocket.RawData;
  isBinary: boolean;
}

export interface ProxyCallbacks {
  onFrameUpdate?: (sessionId: string, frameBase64: string) => void;
  onSessionUpdate?: () => void;
}

/**
 * Attaches an early message buffer to an incoming client WebSocket so initial
 * CDP commands sent during browser startup are never dropped before the
 * Chromium DevTools WebSocket opens.
 */
export function createClientMessageBuffer(clientWs: WebSocket): {
  drain: () => BufferedWsMessage[];
  dispose: () => void;
} {
  const buffered: BufferedWsMessage[] = [];
  const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
    buffered.push({ data, isBinary });
  };

  clientWs.on('message', onMessage);

  return {
    drain: () => {
      clientWs.removeListener('message', onMessage);
      return buffered.splice(0, buffered.length);
    },
    dispose: () => {
      clientWs.removeListener('message', onMessage);
      buffered.length = 0;
    },
  };
}

/**
 * Establishes the bidirectional CDP WebSocket proxy between an automation client
 * and Chromium, injecting stealth hooks, tapping screencast frames, and keeping
 * the client socket alive with ping/pong heartbeats.
 */
export function setupCdpProxy(
  clientWs: WebSocket,
  session: BrowserSession,
  config: Pick<ResolvedGridConfig, 'stealth' | 'heartbeatIntervalMs'>,
  callbacks: ProxyCallbacks = {},
  initialBuffer: BufferedWsMessage[] = [],
  logger?: Logger
): Promise<void> {
  // Clean up any leftover proxy attachment from an earlier connection to this named session
  session.proxyTeardown?.();

  const log = logger?.child({ component: 'cdpProxy', sessionId: session.id });

  return new Promise((resolve, reject) => {
    if (clientWs.readyState === WebSocket.CLOSING || clientWs.readyState === WebSocket.CLOSED) {
      reject(new Error('Client WebSocket closed before CDP proxy attached'));
      return;
    }

    const browserWs = new WebSocket(session.wsEndpoint, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });

    session.clientWs = clientWs;
    session.browserWs = browserWs;
    session.status = 'active';
    session.lastActiveAt = Date.now();

    let screencastStarted = false;
    let clientRequestedScreencast = false;
    let internalMessageId = 900_000_000;
    const internalRequestIds = new Set<number>();
    let settled = false;
    let browserReady = false;
    let tornDown = false;
    let isClientAlive = true;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const pendingClientMessages: BufferedWsMessage[] = [...initialBuffer];

    const sendToBrowser = (payload: WebSocket.RawData | string, isBinary = false) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(payload, { binary: isBinary });
      }
    };

    const sendInternalCommand = (
      method: string,
      params: Record<string, unknown>,
      cdpSessionId?: string
    ) => {
      const id = ++internalMessageId;
      internalRequestIds.add(id);
      const command: Record<string, unknown> = { id, method, params };
      if (cdpSessionId) {
        command.sessionId = cdpSessionId;
      }
      sendToBrowser(JSON.stringify(command));
    };

    const forwardClientMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      session.lastActiveAt = Date.now();
      session.metrics.messagesProxied++;
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString('utf-8')) as { method?: string };
          if (msg.method === 'Page.startScreencast') {
            clientRequestedScreencast = true;
          } else if (msg.method === 'Page.stopScreencast') {
            clientRequestedScreencast = false;
          }
        } catch {
          // forward raw payload as-is
        }
      }
      sendToBrowser(data, isBinary);
    };

    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      pendingClientMessages.length = 0;
      internalRequestIds.clear();

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }

      clientWs.removeListener('message', onClientMessage);
      clientWs.removeListener('close', onClientClose);
      clientWs.removeListener('error', onClientError);
      clientWs.removeListener('pong', onClientPong);

      browserWs.removeListener('open', onBrowserOpen);
      browserWs.removeListener('message', onBrowserMessage);
      browserWs.removeListener('error', onBrowserError);
      browserWs.removeListener('close', onBrowserClose);

      if (session.clientWs === clientWs) {
        session.clientWs = undefined;
      }
      if (session.browserWs === browserWs) {
        session.browserWs = undefined;
      }
      if (session.proxyTeardown === teardown) {
        session.proxyTeardown = undefined;
      }

      if (
        browserWs.readyState === WebSocket.OPEN ||
        browserWs.readyState === WebSocket.CONNECTING
      ) {
        try {
          browserWs.close(1000, 'Proxy detached');
        } catch {
          browserWs.terminate();
        }
      }
    };

    session.proxyTeardown = teardown;

    const onClientPong = () => {
      isClientAlive = true;
    };

    const onClientMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      session.lastActiveAt = Date.now();
      if (!browserReady) {
        pendingClientMessages.push({ data, isBinary });
        return;
      }
      forwardClientMessage(data, isBinary);
    };

    const onClientClose = () => {
      log?.debug('Client WebSocket disconnected');
      if (session.status === 'active') {
        session.status = 'ready';
      }
      teardown();
      callbacks.onSessionUpdate?.();
    };

    const onClientError = (err: Error) => {
      log?.warn('Client WebSocket error', { err });
      if (session.status === 'active') {
        session.status = 'ready';
      }
      teardown();
      callbacks.onSessionUpdate?.();
    };

    const onBrowserOpen = () => {
      settled = true;
      browserReady = true;
      log?.debug('Connected to Chromium DevTools endpoint');

      // Flush any CDP commands received before browserWs finished connecting
      for (const msg of pendingClientMessages) {
        forwardClientMessage(msg.data, msg.isBinary);
      }
      pendingClientMessages.length = 0;

      // Subscribe to target lifecycle events for stealth injection and live screencasting
      sendInternalCommand('Target.setDiscoverTargets', { discover: true });

      if (config.heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(() => {
          if (!isClientAlive) {
            log?.warn('Closing unresponsive client WebSocket after missed heartbeat');
            teardown();
            clientWs.terminate();
            return;
          }
          isClientAlive = false;
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.ping();
          }
        }, config.heartbeatIntervalMs);
        heartbeatTimer.unref();
      }

      resolve();
    };

    const onBrowserMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      session.lastActiveAt = Date.now();
      session.metrics.messagesProxied++;

      if (!isBinary) {
        try {
          const text = data.toString('utf-8');
          const msg = JSON.parse(text);

          // Never leak responses for proxy-internal CDP requests back to the client
          if (typeof msg.id === 'number' && internalRequestIds.has(msg.id)) {
            internalRequestIds.delete(msg.id);
            return;
          }

          if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
            const info = msg.params?.targetInfo;
            if (info && info.type === 'page') {
              session.url = info.url || session.url;
              session.title = info.title || session.title;
            }
          }

          if (msg.method === 'Page.screencastFrame') {
            session.metrics.framesReceived++;
            const { data: frameData, sessionId: frameSessionId } = msg.params;
            session.latestScreenshot = frameData;
            callbacks.onFrameUpdate?.(session.id, frameData);

            sendInternalCommand(
              'Page.screencastFrameAck',
              { sessionId: frameSessionId },
              msg.sessionId
            );

            if (!clientRequestedScreencast) {
              return;
            }
          }

          if (msg.method === 'Target.attachedToTarget' && msg.params?.targetInfo?.type === 'page') {
            const targetSessionId = msg.params.sessionId as string;

            if (config.stealth) {
              sendInternalCommand(
                'Page.addScriptToEvaluateOnNewDocument',
                { source: STEALTH_INJECTION_SCRIPT },
                targetSessionId
              );
            }

            if (!screencastStarted) {
              screencastStarted = true;
              sendInternalCommand(
                'Page.startScreencast',
                {
                  format: 'jpeg',
                  quality: 65,
                  maxWidth: 1280,
                  maxHeight: 800,
                  everyNthFrame: 1,
                },
                targetSessionId
              );
            }
          }
        } catch {
          // Non-JSON or unexpected payload still passes straight through
        }
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    };

    const onBrowserError = (err: Error) => {
      log?.error('Chromium WebSocket error', { err });
      teardown();
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, `Browser error: ${err.message}`);
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const onBrowserClose = () => {
      log?.debug('Chromium WebSocket closed');
      teardown();
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, 'Browser session terminated');
      }
      callbacks.onSessionUpdate?.();
      if (!settled) {
        settled = true;
        reject(new Error('Browser WebSocket closed before handshake completed'));
      }
    };

    clientWs.on('pong', onClientPong);
    clientWs.on('message', onClientMessage);
    clientWs.on('close', onClientClose);
    clientWs.on('error', onClientError);

    browserWs.on('open', onBrowserOpen);
    browserWs.on('message', onBrowserMessage);
    browserWs.on('error', onBrowserError);
    browserWs.on('close', onBrowserClose);
  });
}
