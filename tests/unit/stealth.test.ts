import test from 'node:test';
import assert from 'node:assert';
import * as vm from 'node:vm';
import { resolveGridConfig } from '../../src/config.js';
import { getDashboardHtml } from '../../src/dashboard.js';
import {
  buildStealthScript,
  hashSessionSeed,
  resolveStealthProfile,
  STEALTH_INJECTION_SCRIPT,
  STEALTH_LAUNCH_FLAGS,
} from '../../src/stealth.js';

test('Stealth launch flags enable WebGL and mask AutomationControlled without disabling CORS', () => {
  assert.ok(
    STEALTH_LAUNCH_FLAGS.includes('--disable-blink-features=AutomationControlled'),
    'must disable AutomationControlled blink feature'
  );
  assert.ok(STEALTH_LAUNCH_FLAGS.includes('--enable-webgl'));
  assert.ok(!STEALTH_LAUNCH_FLAGS.includes('--disable-web-security'));
  assert.ok(STEALTH_INJECTION_SCRIPT.includes('webdriver'));
  assert.ok(STEALTH_INJECTION_SCRIPT.includes('window.chrome'));
});

test('resolveStealthProfile produces deterministic coherent profiles per preset and seed', () => {
  const win = resolveStealthProfile('sess-1', { preset: 'windows', locale: 'en-GB', seed: 42 });
  assert.strictEqual(win.preset, 'windows');
  assert.strictEqual(win.platform, 'Win32');
  assert.strictEqual(win.userAgentMetadata.platform, 'Windows');
  assert.deepStrictEqual(win.languages, ['en-GB', 'en']);
  assert.strictEqual(win.acceptLanguage, 'en-GB,en;q=0.9');
  assert.ok(win.userAgent.includes('Windows NT 10.0'));
  assert.ok(win.webglVendor.includes('Google Inc.'));

  const mac1 = resolveStealthProfile('persistent-acct', { preset: 'macos' });
  const mac2 = resolveStealthProfile('persistent-acct', { preset: 'macos' });
  assert.deepStrictEqual(mac1, mac2);
  assert.notStrictEqual(hashSessionSeed('a'), hashSessionSeed('b'));
});

test('buildStealthScript patches navigator, WebGL, AudioBuffer, and prevents double injection', () => {
  const profile = resolveStealthProfile('vm-test', {
    preset: 'linux',
    locale: 'fr-FR',
    timezone: 'Europe/Paris',
    seed: 1337,
  });
  const script = buildStealthScript(profile);

  class FakeNavigator {}
  Object.defineProperty(FakeNavigator.prototype, 'webdriver', {
    get: () => true,
    configurable: true,
  });
  const navigatorObj = new FakeNavigator();

  class FakeWebGL {
    getParameter(param: number) {
      return param === 7936 ? 'orig-vendor' : 'orig-other';
    }
  }

  class FakeAudioBuffer {
    private arr = new Float32Array(64);
    getChannelData() {
      return this.arr;
    }
  }

  const sandbox: Record<string, unknown> = {
    navigator: navigatorObj,
    WebGLRenderingContext: FakeWebGL,
    WebGL2RenderingContext: FakeWebGL,
    AudioBuffer: FakeAudioBuffer,
    Notification: { permission: 'default' },
    outerWidth: 0,
    outerHeight: 0,
    innerWidth: 1280,
    innerHeight: 720,
  };
  sandbox.window = sandbox;

  vm.runInNewContext(script, sandbox);

  const nav = sandbox.navigator as Record<string, unknown>;
  assert.strictEqual(nav.webdriver, undefined);
  assert.strictEqual(nav.platform, 'Linux x86_64');
  assert.deepStrictEqual(Array.from(nav.languages as string[]), ['fr-FR', 'fr']);
  assert.strictEqual(nav.hardwareConcurrency, profile.hardwareConcurrency);
  assert.strictEqual(nav.deviceMemory, profile.deviceMemory);
  assert.strictEqual((nav.plugins as unknown[]).length, 3);

  const gl = new FakeWebGL();
  assert.strictEqual(gl.getParameter(37445), profile.webglVendor);
  assert.strictEqual(gl.getParameter(37446), profile.webglRenderer);
  assert.strictEqual(gl.getParameter(7936), 'orig-vendor');

  const audio = new FakeAudioBuffer();
  const data1 = audio.getChannelData();
  const snapshot = Array.from(data1);
  const data2 = Array.from(audio.getChannelData());
  assert.ok(snapshot.some((v) => v !== 0));
  assert.deepStrictEqual(snapshot, data2);

  // Running script a second time on same window must no-op cleanly
  vm.runInNewContext(script, sandbox);
  assert.strictEqual(sandbox.__openBrowserGridStealth, true);
});

test('Dashboard HTML injects configured port and escapes dynamic fields', () => {
  const html = getDashboardHtml(4123);
  assert.ok(html.includes('const port = 4123;'));
  assert.ok(html.includes('function escapeHtml'));
  assert.ok(html.includes('data-tab="playwright"'));
});

test('resolveGridConfig preserves explicit port 0 and populates Phase 2/3 defaults', () => {
  const config = resolveGridConfig({ port: 0, maxSessions: 4 });
  assert.strictEqual(config.port, 0);
  assert.strictEqual(config.maxSessions, 4);
  assert.strictEqual(config.queueTimeoutMs, 15000);
  assert.strictEqual(config.maxQueueSize, 25);
  assert.strictEqual(config.heartbeatIntervalMs, 15000);
  assert.strictEqual(config.watchdogIntervalMs, 10000);
  assert.ok(config.profilesDir.includes('browsergrid-profiles'));
});
