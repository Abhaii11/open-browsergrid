import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { resolveSessionUserDataDir, type LaunchResult } from '../../src/browserLauncher.js';
import { createLogger } from '../../src/logger.js';
import { SessionManager } from '../../src/sessionManager.js';
import {
  ProfileInUseError,
  QueueFullError,
  QueueTimeoutError,
  type GridConfig,
  type ResolvedGridConfig,
} from '../../src/types.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function createStubChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;

  Object.defineProperty(child, 'pid', { value: Math.floor(Math.random() * 50000) + 1000 });
  Object.defineProperty(child, 'exitCode', { get: () => exitCode });
  Object.defineProperty(child, 'signalCode', { get: () => signalCode });

  child.kill = ((signal?: NodeJS.Signals | number) => {
    if (exitCode !== null || signalCode !== null) return false;
    signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
    exitCode = 0;
    setImmediate(() => child.emit('exit', exitCode, signalCode));
    return true;
  }) as ChildProcess['kill'];

  return child;
}

function makeConfig(overrides: Partial<GridConfig> = {}): GridConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    maxSessions: 2,
    sessionTimeoutMs: 60000,
    queueTimeoutMs: 500,
    maxQueueSize: 2,
    headless: true,
    stealth: true,
    watchdogIntervalMs: 60000,
    logLevel: 'silent',
    ...overrides,
  };
}

function createStubLauncher(delayMs = 0) {
  let launches = 0;
  const children = new Map<string, ChildProcess & EventEmitter>();

  const launcher = async (
    sessionId: string,
    cfg: ResolvedGridConfig,
    profileId?: string
  ): Promise<LaunchResult> => {
    launches++;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const resolved = resolveSessionUserDataDir(sessionId, cfg, profileId);
    await fs.promises.mkdir(resolved.userDataDir, { recursive: true });
    const child = createStubChild();
    children.set(sessionId, child);
    return {
      process: child,
      wsEndpoint: `ws://127.0.0.1:9999/devtools/browser/${sessionId}`,
      cdpPort: 9999,
      userDataDir: resolved.userDataDir,
      persistent: resolved.persistent,
    };
  };

  return {
    launcher,
    getLaunchCount: () => launches,
    getChild: (id: string) => children.get(id),
  };
}

test('SessionManager deduplicates concurrent named sessions and queues excess requests', async () => {
  const stub = createStubLauncher(25);
  const manager = new SessionManager(makeConfig({ maxSessions: 1, queueTimeoutMs: 1000 }), {
    launcher: stub.launcher,
    logger: createLogger({ level: 'silent' }),
  });

  // Two simultaneous requests with the same ID only launch once
  const [s1, s2] = await Promise.all([
    manager.createSession({ id: 'shared-agent', metadata: { role: 'planner' } }),
    manager.createSession({ id: 'shared-agent' }),
  ]);
  assert.strictEqual(s1.id, s2.id);
  assert.strictEqual(stub.getLaunchCount(), 1);
  assert.deepStrictEqual(s1.metadata, { role: 'planner' });

  // Pool is full (maxSessions = 1); queuing second session resolves as soon as first closes
  let secondResolved = false;
  const secondPromise = manager.createSession({ id: 'second-agent' }).then((s) => {
    secondResolved = true;
    return s;
  });

  await waitUntil(() => manager.getStats().queuedRequests === 1);
  assert.strictEqual(secondResolved, false);

  await manager.closeSession('shared-agent');
  const second = await secondPromise;
  assert.strictEqual(second.id, 'second-agent');
  assert.strictEqual(manager.getStats().activeSessions, 1);

  await manager.shutdown();
});

test('SessionManager rejects QueueFullError and QueueTimeoutError cleanly', async () => {
  const stub = createStubLauncher(0);
  const manager = new SessionManager(
    makeConfig({ maxSessions: 1, maxQueueSize: 1, queueTimeoutMs: 60 }),
    {
      launcher: stub.launcher,
      logger: createLogger({ level: 'silent' }),
    }
  );

  await manager.createSession({ id: 'slot-1' });

  const waiting = manager.createSession({ id: 'slot-2' });
  const waitingRejection = assert.rejects(waiting, QueueTimeoutError);

  await assert.rejects(manager.createSession({ id: 'slot-3' }), QueueFullError);
  await waitingRejection;

  await manager.shutdown();
});

test('SessionManager recovers automatically from unexpected Chromium crash', async () => {
  const stub = createStubLauncher(0);
  const manager = new SessionManager(makeConfig({ maxSessions: 1 }), {
    launcher: stub.launcher,
    logger: createLogger({ level: 'silent' }),
  });

  const session = await manager.createSession({ id: 'crash-prone' });
  const dir = session.userDataDir;
  assert.strictEqual(fs.existsSync(dir), true);

  // Trigger unexpected exit (code 137 = SIGKILL crash)
  stub.getChild('crash-prone')?.emit('exit', 137, null);
  await waitUntil(() => !manager.getSession('crash-prone') && !fs.existsSync(dir));

  assert.strictEqual(manager.getStats().activeSessions, 0);

  // Pool slot is freed for new sessions
  const replacement = await manager.createSession({ id: 'recovered' });
  assert.strictEqual(replacement.status, 'ready');

  await manager.shutdown();
});

test('SessionManager watchdog reaps idle and oversized-memory sessions', async () => {
  const stub = createStubLauncher(0);
  const memMap = new Map<number, number>();
  const manager = new SessionManager(
    makeConfig({ maxSessions: 4, sessionTimeoutMs: 5000, maxSessionMemoryMb: 512 }),
    {
      launcher: stub.launcher,
      logger: createLogger({ level: 'silent' }),
      getMemoryMb: async (pid) => (pid ? memMap.get(pid) : undefined),
    }
  );

  const idleSession = await manager.createSession({ id: 'idle-one', timeoutMs: 1000 });
  idleSession.lastActiveAt = Date.now() - 5000;

  const heavySession = await manager.createSession({ id: 'heavy-one', timeoutMs: 60000 });
  if (heavySession.process.pid) {
    memMap.set(heavySession.process.pid, 900);
  }

  const healthySession = await manager.createSession({ id: 'healthy-one', timeoutMs: 60000 });
  if (healthySession.process.pid) {
    memMap.set(healthySession.process.pid, 180);
  }

  await manager.runWatchdog();

  assert.strictEqual(manager.getSession('idle-one'), undefined);
  assert.strictEqual(manager.getSession('heavy-one'), undefined);
  assert.strictEqual(manager.getSession('healthy-one')?.memoryMb, 180);

  await manager.shutdown();
});

test('SessionManager preserves persistent profiles on close and prevents concurrent profile attachment', async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bg-sm-profiles-'));
  const profilesDir = path.join(tempRoot, 'profiles');
  const stub = createStubLauncher(0);

  const manager = new SessionManager(
    makeConfig({ maxSessions: 3, profilesDir, userDataDirBase: tempRoot }),
    {
      launcher: stub.launcher,
      logger: createLogger({ level: 'silent' }),
    }
  );

  try {
    const s1 = await manager.createSession({
      id: 'first-run',
      profileId: 'social-bot',
      stealthOptions: { preset: 'windows', timezone: 'America/New_York' },
    });
    assert.strictEqual(s1.persistent, true);
    assert.strictEqual(s1.profileId, 'social-bot');
    assert.strictEqual(s1.stealthProfile?.preset, 'windows');
    await fs.promises.writeFile(path.join(s1.userDataDir, 'Cookies'), 'auth=1');

    // Concurrent session claiming same profileId must be rejected
    await assert.rejects(
      manager.createSession({ id: 'second-run', profileId: 'social-bot' }),
      ProfileInUseError
    );

    // Deleting an active profile is rejected
    await assert.rejects(manager.deleteProfile('social-bot'), ProfileInUseError);

    // Close first session; persistent directory and Cookies must survive
    await manager.closeSession('first-run');
    assert.strictEqual(fs.existsSync(path.join(s1.userDataDir, 'Cookies')), true);

    // Another session can now reuse the persistent profile cleanly
    const s2 = await manager.createSession({ id: 'reused-run', profileId: 'social-bot' });
    assert.strictEqual(s2.userDataDir, s1.userDataDir);

    const profiles = await manager.listProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].id, 'social-bot');
    assert.strictEqual(profiles[0].inUse, true);

    await manager.closeSession('reused-run');
    assert.strictEqual(await manager.deleteProfile('social-bot'), true);
    assert.strictEqual((await manager.listProfiles()).length, 0);
  } finally {
    await manager.shutdown();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
