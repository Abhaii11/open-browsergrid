import test from 'node:test';
import assert from 'node:assert';
import { STEALTH_INJECTION_SCRIPT, STEALTH_LAUNCH_FLAGS } from '../src/stealth.js';
import { getDashboardHtml } from '../src/dashboard.js';

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
