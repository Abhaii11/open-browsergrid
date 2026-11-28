/**
 * Minimal CDP-over-HTTP client for direct server-side commands.
 * Uses the JSON/HTTP endpoints that Chromium exposes on its debug port,
 * then opens a plain WebSocket to send a single CDP command and receive
 * the response — no additional npm dependencies required.
 */

import * as http from 'node:http';
import { WebSocket } from 'ws';

export interface CdpResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: string };
}

/** Fetch the first page target's webSocketDebuggerUrl from the CDP HTTP endpoint. */
export async function getDebuggerUrl(cdpPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const targets = JSON.parse(Buffer.concat(chunks).toString()) as Array<{
            type: string;
            webSocketDebuggerUrl?: string;
          }>;
          const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          if (!page?.webSocketDebuggerUrl) {
            reject(new Error('No debuggable page target found'));
            return;
          }
          resolve(page.webSocketDebuggerUrl);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error('CDP HTTP timeout'));
    });
  });
}

/**
 * Send a single CDP command to the browser and return its response.
 * Opens a fresh WebSocket connection, sends the command, waits for the
 * matching reply, then closes the connection.
 */
export async function sendCdpCommand(
  debuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = 1;
    let settled = false;

    const ws = new WebSocket(debuggerUrl);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    ws.once('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.on('message', (raw) => {
      let parsed: CdpResponse;
      try {
        parsed = JSON.parse(raw.toString()) as CdpResponse;
      } catch {
        return;
      }
      if (parsed.id !== id) return;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        if (parsed.error) {
          reject(new Error(`CDP error ${parsed.error.code}: ${parsed.error.message}`));
        } else {
          resolve(parsed.result);
        }
      }
    });

    ws.once('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
