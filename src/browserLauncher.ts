import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { STEALTH_LAUNCH_FLAGS } from './stealth.js';
import type { GridConfig } from './types.js';

export function findBrowserExecutable(customPath?: string): string {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  } else if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  }

  // Also check playwright cache paths
  const playwrightCache = path.join(
    platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Caches/ms-playwright')
      : path.join(os.homedir(), '.cache/ms-playwright')
  );
  if (fs.existsSync(playwrightCache)) {
    const entries = fs.readdirSync(playwrightCache);
    for (const entry of entries) {
      if (entry.startsWith('chromium-') || entry.startsWith('chrome-')) {
        const full = path.join(playwrightCache, entry);
        if (platform === 'darwin') {
          const macApp = path.join(full, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium');
          if (fs.existsSync(macApp)) candidates.push(macApp);
        } else if (platform === 'linux') {
          const linuxBin = path.join(full, 'chrome-linux/chrome');
          if (fs.existsSync(linuxBin)) candidates.push(linuxBin);
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No Chromium or Chrome executable found on this system (${platform}). ` +
    `Please set CHROME_PATH or install Google Chrome / Chromium.`
  );
}

export interface LaunchResult {
  process: ChildProcess;
  wsEndpoint: string;
  cdpPort: number;
  userDataDir: string;
}

export async function launchBrowserSession(
  sessionId: string,
  config: GridConfig
): Promise<LaunchResult> {
  const executable = findBrowserExecutable(config.executablePath);
  const baseDir = config.userDataDirBase || os.tmpdir();
  const userDataDir = path.join(baseDir, `browsergrid-session-${sessionId}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0', // dynamic unused port
    '--remote-debugging-address=127.0.0.1',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--safebrowsing-disable-auto-update',
  ];

  if (config.headless) {
    args.push('--headless=new');
  }

  if (config.stealth) {
    args.push(...STEALTH_LAUNCH_FLAGS);
  }

  // Open blank page
  args.push('about:blank');

  return new Promise<LaunchResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let settled = false;
    let endpoint = '';
    let port = 0;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for Chrome CDP endpoint for session ${sessionId}`));
      }
    }, 15000);

    const onData = (data: Buffer) => {
      const text = data.toString('utf-8');
      const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[a-zA-Z0-9_-]+)/);
      if (match) {
        endpoint = match[1];
        port = parseInt(match[2], 10);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({
            process: child,
            wsEndpoint: endpoint,
            cdpPort: port,
            userDataDir,
          });
        }
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Browser exited prematurely with code ${code}`));
      }
    });
  });
}
