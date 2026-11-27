import { execFile, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from './logger.js';
import { STEALTH_LAUNCH_FLAGS } from './stealth.js';
import {
  InvalidSessionIdError,
  type GridConfig,
  type ProfileSummary,
  type ResolvedGridConfig,
} from './types.js';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PROFILE_PREFIX = 'profile-';

export function validateSessionId(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }
  return sessionId;
}

export function resolveSessionUserDataDir(
  sessionId: string,
  config: Pick<ResolvedGridConfig, 'userDataDirBase' | 'profilesDir'>,
  profileId?: string
): { userDataDir: string; persistent: boolean } {
  if (profileId) {
    const safeProfileId = validateSessionId(profileId);
    return {
      userDataDir: path.join(config.profilesDir, `${PROFILE_PREFIX}${safeProfileId}`),
      persistent: true,
    };
  }
  const baseDir = config.userDataDirBase || os.tmpdir();
  return {
    userDataDir: path.join(baseDir, `browsergrid-session-${sessionId}`),
    persistent: false,
  };
}

export async function listPersistentProfiles(
  profilesDir: string,
  activeProfileIds: ReadonlySet<string> = new Set()
): Promise<ProfileSummary[]> {
  if (!fs.existsSync(profilesDir)) {
    return [];
  }
  const entries = await fs.promises.readdir(profilesDir, { withFileTypes: true });
  const summaries: ProfileSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PROFILE_PREFIX)) {
      continue;
    }
    const id = entry.name.slice(PROFILE_PREFIX.length);
    if (!SESSION_ID_PATTERN.test(id)) {
      continue;
    }
    const fullPath = path.join(profilesDir, entry.name);
    const stat = await fs.promises.stat(fullPath);
    summaries.push({
      id,
      path: fullPath,
      inUse: activeProfileIds.has(id),
      updatedAt: stat.mtimeMs,
    });
  }

  return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

export async function deletePersistentProfile(
  profilesDir: string,
  profileId: string
): Promise<boolean> {
  const safeId = validateSessionId(profileId);
  const fullPath = path.join(profilesDir, `${PROFILE_PREFIX}${safeId}`);
  if (!fs.existsSync(fullPath)) {
    return false;
  }
  await fs.promises.rm(fullPath, { recursive: true, force: true });
  return true;
}

export function findBrowserExecutable(customPath?: string): string {
  if (customPath) {
    if (fs.existsSync(customPath)) {
      return customPath;
    }
    throw new Error(`Configured browser executable does not exist: ${customPath}`);
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

export function buildLaunchArgs(
  userDataDir: string,
  config: Pick<GridConfig, 'headless' | 'stealth'>
): string[] {
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-sandbox',
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
  } else {
    args.push('--disable-gpu');
  }

  args.push('about:blank');
  return args;
}

export async function cleanupUserDataDir(dir: string, logger?: Logger): Promise<void> {
  if (!dir) return;
  const delays = [0, 75, 200];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === delays.length - 1) {
        logger?.warn('Failed to remove temporary user data directory', {
          userDataDir: dir,
          err,
        });
      }
    }
  }
}

export async function terminateProcess(child: ChildProcess, graceMs = 1500): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(killTimer);
        clearTimeout(finalTimer);
        child.removeListener('exit', done);
        resolve();
      }
    };

    child.once('exit', done);

    try {
      child.kill('SIGTERM');
    } catch {
      done();
      return;
    }

    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, graceMs);

    // Ensure promise never hangs even if OS delays SIGKILL exit notification
    const finalTimer = setTimeout(done, graceMs + 500);
  });
}

export function getProcessMemoryMb(pid: number | undefined): Promise<number | undefined> {
  if (!pid || os.platform() === 'win32') {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }
      const rssKb = Number.parseInt(stdout.trim(), 10);
      if (Number.isNaN(rssKb) || rssKb <= 0) {
        resolve(undefined);
        return;
      }
      resolve(Math.round((rssKb / 1024) * 10) / 10);
    });
  });
}

export interface LaunchResult {
  process: ChildProcess;
  wsEndpoint: string;
  cdpPort: number;
  userDataDir: string;
  persistent?: boolean;
}

export type SessionLauncher = (
  sessionId: string,
  config: ResolvedGridConfig,
  profileId?: string
) => Promise<LaunchResult>;

export async function launchBrowserSession(
  sessionId: string,
  config: ResolvedGridConfig,
  logger?: Logger,
  profileId?: string
): Promise<LaunchResult> {
  validateSessionId(sessionId);
  const executable = findBrowserExecutable(config.executablePath);
  const { userDataDir, persistent } = resolveSessionUserDataDir(sessionId, config, profileId);
  await fs.promises.mkdir(userDataDir, { recursive: true });

  const args = buildLaunchArgs(userDataDir, config);

  return new Promise<LaunchResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let settled = false;
    let stderrTail = '';

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      if (!persistent) {
        void cleanupUserDataDir(userDataDir, logger);
      }
      reject(err);
    };

    const timeout = setTimeout(() => {
      fail(new Error(`Timed out waiting for Chrome CDP endpoint for session ${sessionId}`));
    }, 15000);

    const onData = (data: Buffer) => {
      const text = data.toString('utf-8');
      stderrTail = (stderrTail + text).slice(-1024);
      const match = text.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[a-zA-Z0-9_-]+)/
      );
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.stdout?.removeListener('data', onData);
        child.stderr?.removeListener('data', onData);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        resolve({
          process: child,
          wsEndpoint: match[1],
          cdpPort: Number.parseInt(match[2], 10),
          userDataDir,
          persistent,
        });
      }
    };

    const onError = (err: Error) => {
      fail(err);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const details = stderrTail.trim() ? ` (${stderrTail.trim()})` : '';
      fail(
        new Error(
          `Browser exited prematurely with code=${code ?? 'null'} signal=${signal ?? 'null'}${details}`
        )
      );
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}
