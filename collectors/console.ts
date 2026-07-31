import type { ConsoleEntry, ConsoleLevel } from '../shared/types';

const entries: ConsoleEntry[] = [];
const MAX_ENTRIES = 200;
const original: Partial<Record<ConsoleLevel, (...a: unknown[]) => void>> = {};
let started = false;

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export function startConsoleCollector(): void {
  if (started) return;
  started = true;
  for (const level of LEVELS) {
    const fn = console[level] ? console[level].bind(console) : undefined;
    if (!fn) continue;
    original[level] = fn;
    console[level] = (...args: unknown[]) => {
      try {
        pushEntry(level, args);
      } catch {
        // never let our wrapper break the page
      }
      return fn(...args);
    };
  }
}

export function collectConsole(): ConsoleEntry[] {
  return entries.slice();
}

export function resetConsole(): void {
  entries.length = 0;
}

function pushEntry(level: ConsoleLevel, args: unknown[]): void {
  if (entries.length >= MAX_ENTRIES) entries.shift();
  const message = formatArgs(args);
  const stack = level === 'error' || level === 'warn' ? captureStack() : undefined;
  entries.push({ level, message, timestamp: Date.now(), stack });
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => stringify(a))
    .join(' ');
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v, replacer, 2);
  } catch {
    return String(v);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  return value;
}

function captureStack(): string | undefined {
  const err = new Error();
  const stack = err.stack ?? '';
  const lines = stack.split('\n').filter((l) => !/console\.(warn|error)/.test(l));
  return lines.slice(1, 6).join('\n') || undefined;
}
