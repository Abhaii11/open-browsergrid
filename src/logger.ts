import process from 'node:process';
import type { LogFormat, LogLevel } from './types.js';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  bindings?: Record<string, unknown>;
  write?: (line: string) => void;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function normalizeFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key] = serializeValue(value);
    }
  }
  return result;
}

export function resolveLogLevel(input?: string): LogLevel {
  const normalized = (input || process.env.LOG_LEVEL || 'info').toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error' ||
    normalized === 'silent'
  ) {
    return normalized;
  }
  return 'info';
}

export function resolveLogFormat(input?: string): LogFormat {
  const normalized = (input || process.env.LOG_FORMAT || '').toLowerCase();
  if (normalized === 'json' || normalized === 'pretty') {
    return normalized;
  }
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? resolveLogLevel();
  const format = options.format ?? resolveLogFormat();
  const bindings = normalizeFields(options.bindings);
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });

  const emit = (
    msgLevel: Exclude<LogLevel, 'silent'>,
    msg: string,
    fields?: Record<string, unknown>
  ): void => {
    if (LOG_LEVEL_WEIGHT[msgLevel] < LOG_LEVEL_WEIGHT[level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const merged = { ...bindings, ...normalizeFields(fields) };

    if (format === 'json') {
      const record = {
        timestamp,
        level: msgLevel,
        msg,
        ...merged,
      };
      try {
        write(JSON.stringify(record));
      } catch {
        write(JSON.stringify({ timestamp, level: msgLevel, msg }));
      }
      return;
    }

    const timeShort = timestamp.slice(11, 19);
    const label = msgLevel.toUpperCase().padEnd(5);
    const metaKeys = Object.keys(merged);
    const metaStr = metaKeys.length > 0 ? ` ${JSON.stringify(merged)}` : '';
    write(`[${timeShort}] ${label} ${msg}${metaStr}`);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extraBindings) =>
      createLogger({
        level,
        format,
        bindings: { ...bindings, ...extraBindings },
        write,
      }),
  };
}
