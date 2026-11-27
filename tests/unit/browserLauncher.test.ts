import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import {
  buildLaunchArgs,
  cleanupUserDataDir,
  deletePersistentProfile,
  findBrowserExecutable,
  listPersistentProfiles,
  resolveSessionUserDataDir,
  terminateProcess,
  validateSessionId,
} from '../../src/browserLauncher.js';
import { InvalidSessionIdError } from '../../src/types.js';

test('validateSessionId accepts safe names and rejects traversal or invalid characters', () => {
  assert.strictEqual(validateSessionId('my-scraper_01'), 'my-scraper_01');
  assert.strictEqual(validateSessionId('a'), 'a');

  assert.throws(() => validateSessionId(''), InvalidSessionIdError);
  assert.throws(() => validateSessionId('../etc/passwd'), InvalidSessionIdError);
  assert.throws(() => validateSessionId('foo/bar'), InvalidSessionIdError);
  assert.throws(() => validateSessionId('bad id'), InvalidSessionIdError);
  assert.throws(() => validateSessionId('x'.repeat(65)), InvalidSessionIdError);
});

test('resolveSessionUserDataDir distinguishes ephemeral and persistent profile paths', () => {
  const ephemeral = resolveSessionUserDataDir('sess-1', {
    userDataDirBase: '/tmp/ephemeral',
    profilesDir: '/tmp/profiles',
  });
  assert.strictEqual(ephemeral.persistent, false);
  assert.strictEqual(
    ephemeral.userDataDir,
    path.join('/tmp/ephemeral', 'browsergrid-session-sess-1')
  );

  const persistent = resolveSessionUserDataDir(
    'sess-2',
    {
      userDataDirBase: '/tmp/ephemeral',
      profilesDir: '/tmp/profiles',
    },
    'account_a'
  );
  assert.strictEqual(persistent.persistent, true);
  assert.strictEqual(persistent.userDataDir, path.join('/tmp/profiles', 'profile-account_a'));

  assert.throws(
    () => resolveSessionUserDataDir('sess-3', { profilesDir: '/tmp/profiles' }, '../../outside'),
    InvalidSessionIdError
  );
});

test('listPersistentProfiles and deletePersistentProfile manage profile directories', async () => {
  const profilesDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bg-profiles-unit-'));
  try {
    await fs.promises.mkdir(path.join(profilesDir, 'profile-alpha'));
    await fs.promises.mkdir(path.join(profilesDir, 'profile-beta'));
    await fs.promises.mkdir(path.join(profilesDir, 'ignored-folder'));

    const list = await listPersistentProfiles(profilesDir, new Set(['alpha']));
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, 'alpha');
    assert.strictEqual(list[0].inUse, true);
    assert.strictEqual(list[1].id, 'beta');
    assert.strictEqual(list[1].inUse, false);

    assert.strictEqual(await deletePersistentProfile(profilesDir, 'beta'), true);
    assert.strictEqual(await deletePersistentProfile(profilesDir, 'missing'), false);
    assert.strictEqual(fs.existsSync(path.join(profilesDir, 'profile-beta')), false);
  } finally {
    await fs.promises.rm(profilesDir, { recursive: true, force: true });
  }
});

test('buildLaunchArgs applies headless and stealth flags conditionally', () => {
  const fullStealth = buildLaunchArgs('/tmp/profile-1', { headless: true, stealth: true });
  assert.ok(fullStealth.includes('--user-data-dir=/tmp/profile-1'));
  assert.ok(fullStealth.includes('--headless=new'));
  assert.ok(fullStealth.includes('--disable-blink-features=AutomationControlled'));
  assert.strictEqual(fullStealth[fullStealth.length - 1], 'about:blank');

  const headfulNoStealth = buildLaunchArgs('/tmp/profile-2', { headless: false, stealth: false });
  assert.ok(!headfulNoStealth.includes('--headless=new'));
  assert.ok(!headfulNoStealth.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(headfulNoStealth.includes('--disable-gpu'));
});

test('findBrowserExecutable throws clear error when custom executablePath is missing', () => {
  assert.throws(
    () => findBrowserExecutable('/non/existent/chrome-binary'),
    /Configured browser executable does not exist/
  );
});

test('cleanupUserDataDir removes temporary directory recursively', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'browsergrid-cleanup-test-'));
  await fs.promises.writeFile(path.join(dir, 'lockfile'), '123');
  await cleanupUserDataDir(dir);
  assert.strictEqual(fs.existsSync(dir), false);
});

test('terminateProcess sends SIGTERM and resolves upon exit', async () => {
  const emitter = new EventEmitter() as ChildProcess & EventEmitter;
  Object.defineProperty(emitter, 'exitCode', { value: null, writable: true });
  Object.defineProperty(emitter, 'signalCode', { value: null, writable: true });

  const signals: string[] = [];
  emitter.kill = ((signal?: NodeJS.Signals) => {
    signals.push(signal ?? 'SIGTERM');
    setImmediate(() => {
      (emitter as unknown as { exitCode: number }).exitCode = 0;
      emitter.emit('exit', 0, signal ?? null);
    });
    return true;
  }) as ChildProcess['kill'];

  await terminateProcess(emitter, 500);
  assert.deepStrictEqual(signals, ['SIGTERM']);
});
