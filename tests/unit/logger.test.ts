import test from 'node:test';
import assert from 'node:assert';
import { createLogger, resolveLogFormat, resolveLogLevel } from '../../src/logger.js';

test('Logger respects level threshold filtering', () => {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'warn',
    format: 'json',
    write: (line) => lines.push(line),
  });

  logger.debug('debug message');
  logger.info('info message');
  logger.warn('warn message', { sessionId: 's1' });
  logger.error('error message', { err: new Error('boom') });

  assert.strictEqual(lines.length, 2);

  const warnRecord = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.strictEqual(warnRecord.level, 'warn');
  assert.strictEqual(warnRecord.msg, 'warn message');
  assert.strictEqual(warnRecord.sessionId, 's1');
  assert.ok(typeof warnRecord.timestamp === 'string');

  const errorRecord = JSON.parse(lines[1]) as { err: { name: string; message: string } };
  assert.strictEqual(errorRecord.err.name, 'Error');
  assert.strictEqual(errorRecord.err.message, 'boom');
});

test('Logger child() merges persistent bindings and formats pretty mode', () => {
  const lines: string[] = [];
  const root = createLogger({
    level: 'debug',
    format: 'pretty',
    bindings: { service: 'grid' },
    write: (line) => lines.push(line),
  });

  const child = root.child({ sessionId: 'abc123' });
  child.info('session ready', { cdpPort: 9222 });

  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes('INFO'));
  assert.ok(lines[0].includes('session ready'));
  assert.ok(lines[0].includes('"service":"grid"'));
  assert.ok(lines[0].includes('"sessionId":"abc123"'));
  assert.ok(lines[0].includes('"cdpPort":9222'));
});

test('resolveLogLevel and resolveLogFormat fall back safely on unknown values', () => {
  assert.strictEqual(resolveLogLevel('DEBUG'), 'debug');
  assert.strictEqual(resolveLogLevel('invalid-level'), 'info');
  assert.strictEqual(resolveLogFormat('JSON'), 'json');
  assert.strictEqual(resolveLogFormat('pretty'), 'pretty');
});
