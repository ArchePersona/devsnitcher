import type { NetworkEntry } from '../shared/types';

const entries: NetworkEntry[] = [];
const MAX_ENTRIES = 100;
const PREVIEW_MAX = 1000;
let started = false;

export function startNetworkCollector(): void {
  if (started) return;
  started = true;
  wrapFetch();
  wrapXhr();
}

export function collectNetwork(): NetworkEntry[] {
  return entries.slice();
}

export function resetNetwork(): void {
  entries.length = 0;
  started = false;
}

function wrapFetch(): void {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  window.fetch = async function fetchWrapper(input: RequestInfo | URL, init?: RequestInit) {
    const url = normalizeUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = extractHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const start = performance.now();
    let response: Response;
    try {
      response = await originalFetch(input as RequestInfo, init);
    } catch (err) {
      pushFailure(url, method, 0, start, String(err), headers);
      throw err;
    }
    const status = response.status;
    if (status === 0 || status >= 400) {
      let preview = '';
      try {
        const clone = response.clone();
        preview = await clone.text();
      } catch {
        preview = '';
      }
      pushEntry({
        url,
        method,
        status,
        duration: Math.round(performance.now() - start),
        responsePreview: truncate(preview),
        requestHeaders: headers,
      });
    }
    return response;
  };
}

function wrapXhr(): void {
  const OriginalOpen = XMLHttpRequest.prototype.open;
  const OriginalSend = XMLHttpRequest.prototype.send;
  const OriginalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function mockOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...allArgs: unknown[]
  ) {
    (this as any).__ds_method = (method || 'GET').toUpperCase();
    (this as any).__ds_url = url;
    (this as any).__ds_headers = {};
    (this as any).__ds_start = 0;
    const asyncFlag = allArgs.length > 0 ? (allArgs[0] as boolean) : undefined;
    const xhrUser = allArgs.length > 1 ? (allArgs[1] as string | null) : undefined;
    const xhrPass = allArgs.length > 2 ? (allArgs[2] as string | null) : undefined;
    return OriginalOpen.call(this, method, url, asyncFlag ?? true, xhrUser, xhrPass);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function mockSetHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    try {
      ((this as any).__ds_headers as Record<string, string>)[name] = value;
    } catch {
      // ignore
    }
    return OriginalSetHeader.call(this, name, value);
  } as typeof XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.send = function mockSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    (this as any).__ds_start = performance.now();
    this.addEventListener('loadend', () => {
      const status = this.status;
      if (status === 0 || status >= 400) {
        let preview = '';
        try {
          preview = typeof this.responseText === 'string' ? this.responseText : '';
        } catch {
          preview = '';
        }
        pushEntry({
          url: (this as any).__ds_url ?? '',
          method: (this as any).__ds_method ?? 'GET',
          status,
          duration: Math.round(performance.now() - ((this as any).__ds_start ?? performance.now())),
          responsePreview: truncate(preview),
          requestHeaders: (this as any).__ds_headers ?? {},
        });
      }
    });
    return OriginalSend.call(this, body);
  } as typeof XMLHttpRequest.prototype.send;
}

function pushFailure(url: string, method: string, status: number, start: number, preview: string, headers: Record<string, string>): void {
  pushEntry({
    url,
    method,
    status,
    duration: Math.round(performance.now() - start),
    responsePreview: truncate(preview),
    requestHeaders: headers,
  });
}

function pushEntry(entry: NetworkEntry): void {
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push(entry);
}

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function extractHeaders(headers: HeadersInit | Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(headers)) out[k] = v as string;
  }
  return out;
}

function truncate(s: string): string {
  if (!s) return '';
  return s.length <= PREVIEW_MAX ? s : s.slice(0, PREVIEW_MAX) + '…';
}
