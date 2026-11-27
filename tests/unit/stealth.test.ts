import test from 'node:test';
import assert from 'node:assert';
import { resolveGridConfig } from '../../src/config.js';
import { getDashboardHtml } from '../../src/dashboard.js';
import { STEALTH_INJECTION_SCRIPT, STEALTH_LAUNCH_FLAGS } from '../../src/stealth.js';

test('Stealth configuration masks automation signals', () => {
  assert.ok(
    STEALTH_LAUNCH_FLAGS.includes('--disable-blink-features=AutomationControlled'),
    'must disable AutomationControlled blink feature'
  );
  assert.ok(STEALTH_INJECTION_SCRIPT.includes('webdriver'));
  assert.ok(STEALTH_INJECTION_SCRIPT.includes('window.chrome'));
  assert.ok(STEALTH_INJECTION_SCRIPT.includes('navigator'));
});

test('Dashboard HTML injects configured port and escapes dynamic fields', () => {
  const html = getDashboardHtml(4123);
  assert.ok(html.includes('const port = 4123;'));
  assert.ok(html.includes('function escapeHtml'));
  assert.ok(html.includes('data-tab="playwright"'));
});

test('resolveGridConfig preserves explicit port 0 and populates Phase 2 defaults', () => {
  const config = resolveGridConfig({ port: 0, maxSessions: 4 });
  assert.strictEqual(config.port, 0);
  assert.strictEqual(config.maxSessions, 4);
  assert.strictEqual(config.queueTimeoutMs, 15000);
  assert.strictEqual(config.maxQueueSize, 25);
  assert.strictEqual(config.heartbeatIntervalMs, 15000);
  assert.strictEqual(config.watchdogIntervalMs, 10000);
});
