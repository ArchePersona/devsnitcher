import type { JsErrorEntry } from '../shared/types';

const entries: JsErrorEntry[] = [];
const MAX_ENTRIES = 50;

export function startJavaScriptCollector(): void {
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection, true);
}

export function collectJavaScript(): JsErrorEntry[] {
  return entries.slice();
}

export function resetJavaScript(): void {
  entries.length = 0;
}

function onError(ev: ErrorEvent): void {
  pushEntry({
    type: 'unhandled_exception',
    message: ev.message,
    filename: ev.filename,
    lineno: ev.lineno,
    colno: ev.colno,
    stack: ev.error?.stack ?? '',
  });
}

function onRejection(ev: PromiseRejectionEvent): void {
  const reason = ev.reason;
  let message: string;
  let stack = '';
  if (reason instanceof Error) {
    message = reason.message;
    stack = reason.stack ?? '';
  } else {
    try {
      message = JSON.stringify(reason, undefined, 2);
    } catch {
      message = String(reason);
    }
  }
  pushEntry({
    type: 'promise_rejection',
    message,
    stack,
  });
}

function pushEntry(entry: JsErrorEntry): void {
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push(entry);
}
