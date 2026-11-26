import WebSocket from 'ws';
import { STEALTH_INJECTION_SCRIPT } from './stealth.js';
import type { BrowserSession, GridConfig } from './types.js';

/**
 * Handles the bidirectional CDP WebSocket proxy between an incoming automation
 * client (Playwright, Puppeteer, browser-use) and the underlying Chromium process.
 * Also taps into the session to extract live screencast frames and inject stealth scripts.
 */
export function setupCdpProxy(
  clientWs: WebSocket,
  session: BrowserSession,
  config: GridConfig,
  onFrameUpdate?: (sessionId: string, frameBase64: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const browserWs = new WebSocket(session.wsEndpoint, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });

    session.clientWs = clientWs;
    session.browserWs = browserWs;
    session.status = 'active';

    let screencastStarted = false;
    let internalMessageId = 900000;

    browserWs.on('open', () => {
      // Browser connected
      resolve();

      // Enable target discovery to inject stealth script and start screencast on pages
      browserWs.send(JSON.stringify({
        id: ++internalMessageId,
        method: 'Target.setDiscoverTargets',
        params: { discover: true }
      }));
    });

    browserWs.on('error', (err) => {
      clientWs.close(1011, `Browser error: ${err.message}`);
      reject(err);
    });

    // Handle messages from Chromium to the automation client
    browserWs.on('message', (data: WebSocket.RawData) => {
      session.lastActiveAt = Date.now();
      session.metrics.messagesProxied++;

      try {
        const text = data.toString('utf-8');
        const msg = JSON.parse(text);

        // Tap into target created / attached
        if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
          const info = msg.params?.targetInfo;
          if (info && info.type === 'page') {
            session.url = info.url || session.url;
            session.title = info.title || session.title;
          }
        }

        // Tap into screencast frames for the dashboard
        if (msg.method === 'Page.screencastFrame') {
          session.metrics.framesReceived++;
          const { data: frameData, sessionId: frameSessionId } = msg.params;
          session.latestScreenshot = frameData;

          if (onFrameUpdate) {
            onFrameUpdate(session.id, frameData);
          }

          // Acknowledge the frame so Chromium continues streaming
          browserWs.send(JSON.stringify({
            id: ++internalMessageId,
            sessionId: frameSessionId,
            method: 'Page.screencastFrameAck',
            params: { sessionId: frameSessionId }
          }));
        }

        // If a page target is attached, inject stealth script and start screencasting
        if (msg.method === 'Target.attachedToTarget' && msg.params?.targetInfo?.type === 'page') {
          const targetSessionId = msg.params.sessionId;

          if (config.stealth) {
            browserWs.send(JSON.stringify({
              id: ++internalMessageId,
              sessionId: targetSessionId,
              method: 'Page.addScriptToEvaluateOnNewDocument',
              params: { source: STEALTH_INJECTION_SCRIPT }
            }));
          }

          // Start screencast for the web viewer
          if (!screencastStarted) {
            screencastStarted = true;
            browserWs.send(JSON.stringify({
              id: ++internalMessageId,
              sessionId: targetSessionId,
              method: 'Page.startScreencast',
              params: {
                format: 'jpeg',
                quality: 65,
                maxWidth: 1280,
                maxHeight: 800,
                everyNthFrame: 1
              }
            }));
          }
        }

        // Forward to client if client connection is open
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      } catch {
        // Raw passthrough on parse failure
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      }
    });

    // Handle messages from client to Chromium
    clientWs.on('message', (data: WebSocket.RawData) => {
      session.lastActiveAt = Date.now();
      session.metrics.messagesProxied++;

      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data);
      }
    });

    clientWs.on('close', () => {
      session.status = 'ready'; // client disconnected, session remains re-attachable or reaped
      session.clientWs = undefined;
    });

    browserWs.on('close', () => {
      session.status = 'closed';
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, 'Browser session terminated');
      }
    });
  });
}
