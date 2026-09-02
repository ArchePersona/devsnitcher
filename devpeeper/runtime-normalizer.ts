import type { ConsoleEntry, ConsoleLevel, JsErrorEntry } from '../shared/types';

/**
 * Bounded, deterministic normalization of the CDP `Runtime` domain events that
 * DEVPEEPER-003 observes: `Runtime.consoleAPICalled` and
 * `Runtime.exceptionThrown`.
 *
 * These normalizers only read browser-supplied fields. They never recursively
 * inspect page objects, call `Runtime.getProperties`, or execute page
 * JavaScript to reconstruct formatting. Anything Chromium does not supply is
 * left absent rather than invented.
 */

interface RemoteObjectLike {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

interface CallFrameLike {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface StackTraceLike {
  callFrames?: CallFrameLike[];
}

export interface ConsoleApiParams {
  type?: string;
  args?: RemoteObjectLike[];
  timestamp?: number;
  executionContextId?: number;
  stackTrace?: StackTraceLike;
}

export interface ExceptionDetailsLike {
  exceptionId?: number;
  text?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
  url?: string;
  stackTrace?: StackTraceLike;
  exception?: RemoteObjectLike;
  executionContextId?: number;
}

export interface ExceptionThrownParams {
  timestamp?: number;
  executionContextId?: number;
  exceptionDetails?: ExceptionDetailsLike;
}

/** Console types DEVSnitch represents. Everything else is ignored. */
const CONSOLE_TYPE_TO_LEVEL: Partial<Record<string, ConsoleLevel>> = {
  log: 'log',
  info: 'info',
  warning: 'warn',
  error: 'error',
  debug: 'debug',
};

export interface NormalizedConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: number;
  stack?: string;
}

/** Normalizes `Runtime.consoleAPICalled` into a DEVSnitch console entry, or null. */
export function normalizeConsoleApi(params: ConsoleApiParams): NormalizedConsoleEntry | null {
  const level = params.type ? CONSOLE_TYPE_TO_LEVEL[params.type] : undefined;
  if (!level) return null;

  const args = Array.isArray(params.args) ? params.args : [];
  const message = args.map(formatRemoteObject).join(' ').trim();
  if (message.length === 0) return null;

  const entry: NormalizedConsoleEntry = {
    level,
    message,
    timestamp: normalizeTimestamp(params.timestamp),
  };
  if (params.stackTrace?.callFrames?.length) {
    entry.stack = formatStackTrace(params.stackTrace.callFrames);
  }
  return entry;
}

/**
 * Normalizes `Runtime.exceptionThrown` into a DEVSnitch JS-error entry, or null.
 *
 * Chromium's `exceptionThrown` event does not expose a reliable flag
 * distinguishing an unhandled promise rejection from an unhandled exception, so
 * the only honest classification is `unhandled_exception`. No `promise_rejection`
 * value is synthesized without evidence for it.
 */
export function normalizeExceptionThrown(params: ExceptionThrownParams): JsErrorEntry | null {
  const details = params.exceptionDetails;
  if (!details) return null;

  const description = details.exception?.description ?? '';
  const stack: string =
    (description.length > 0
      ? description
      : details.stackTrace?.callFrames?.length
        ? formatStackTrace(details.stackTrace.callFrames)
        : '');

  let message = details.text ?? '';
  if (message.length === 0 && description.length > 0) {
    message = description.split('\n')[0] ?? '';
  }

  const entry: JsErrorEntry = {
    type: 'unhandled_exception',
    message,
    ...(details.url ? { filename: details.url } : {}),
    ...(details.lineNumber != null ? { lineno: details.lineNumber } : {}),
    ...(details.columnNumber != null ? { colno: details.columnNumber } : {}),
    stack,
  };
  return entry;
}

function formatRemoteObject(obj: RemoteObjectLike): string {
  if (obj.value !== undefined) return String(obj.value);
  if (obj.unserializableValue) return obj.unserializableValue;
  if (obj.description) return obj.description;
  if (obj.subtype) return obj.subtype;
  if (obj.type) return obj.type;
  return '';
}

/**
 * CDP `timestamp` is fractional seconds since epoch. DEVSnitch console entries
 * store epoch milliseconds. If no timestamp is supplied, fall back to now.
 */
function normalizeTimestamp(timestamp: number | undefined): number {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return Math.round(timestamp * 1000);
  }
  return Date.now();
}

/**
 * Renders `StackTrace.callFrames` as conventional, human-readable stack lines.
 * Frame line/column numbers are 1-based for display even though CDP supplies
 * them 0-based; this is presentation formatting, not provenance.
 */
function formatStackTrace(callFrames: CallFrameLike[]): string {
  return callFrames
    .map((frame) => {
      const fn = frame.functionName || '<anonymous>';
      if (!frame.url) return `    at ${fn}`;
      const line = (frame.lineNumber ?? 0) + 1;
      const col = (frame.columnNumber ?? 0) + 1;
      return `    at ${fn} (${frame.url}:${line}:${col})`;
    })
    .join('\n');
}

export type { ConsoleEntry, JsErrorEntry };
