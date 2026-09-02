import { test, describe, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head><title>TestPage</title></head><body></body></html>', {
  url: 'https://example.com/test-page',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
});

const { window } = dom;

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis as any, name, {
    value,
    writable: true,
    configurable: true,
  });
}

// Install browser globals from jsdom where available, fall back to Node built-ins
setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('navigator', window.navigator);
setGlobal('console', window.console);
setGlobal('performance', globalThis.performance);
setGlobal('customElements', window.customElements);
setGlobal('XMLHttpRequest', window.XMLHttpRequest);
// Use Node's built-in Request/Response/fetch if jsdom doesn't provide them
const ReqCtor = (window as any).Request || globalThis.Request;
const RespCtor = (window as any).Response || globalThis.Response;
setGlobal('Request', ReqCtor);
setGlobal('Headers', (window as any).Headers || globalThis.Headers);
setGlobal('Response', RespCtor);
setGlobal('Element', window.Element);
setGlobal('location', window.location);
setGlobal('ErrorEvent', window.ErrorEvent);
setGlobal('PromiseRejectionEvent', window.PromiseRejectionEvent);
setGlobal('Event', window.Event);

// Mock chrome API for screenshot — accepts both (windowId, opts, cb) and (opts, cb)
setGlobal('chrome', {
  tabs: {
    captureVisibleTab: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') (cb as (d: string) => void)('data:image/png;base64,iVBORw0KGgo=');
    },
  },
  runtime: {},
} as any);

// Mock createImageBitmap for screenshot dimension decoding
setGlobal(
  'createImageBitmap',
  (async () => ({
    width: 1280,
    height: 720,
    close() {},
  })) as any,
);

// Now import collectors and report modules
import { collectEnvironment } from '../collectors/environment';
import { startConsoleCollector, collectConsole, resetConsole } from '../collectors/console';
import { startNetworkCollector, collectNetwork, resetNetwork } from '../collectors/network';
import { startJavaScriptCollector, collectJavaScript, resetJavaScript } from '../collectors/javascript';
import { collectDom } from '../collectors/dom';
import { captureScreenshot } from '../collectors/screenshot';
import { redactEvidence, redactCookieString } from '../redaction/index';
import { buildMarkdownReport } from '../report/markdown';
import { buildJsonReport } from '../report/json';
import {
  EvidenceCache,
  cacheRecordKey,
  isEvidenceShape,
  type SessionStorageLike,
} from '../extension/background/cache';
import { snapshotProbe, type BoundedSnapshot } from '../devpeeper/snapshot-probe';
import {
  makeBoundedObservation,
  normalizeBoundedSnapshot,
  type InjectionResultLike,
} from '../devpeeper/observation';
import { ChromiumObserver } from '../devpeeper/chromium';
import type { DebuggerTarget, DebuggerTransport } from '../devpeeper/debugger-transport';
import type { Evidence, NetworkEntry } from '../shared/types';

describe('DEVSnitcher collectors', () => {
  beforeEach(() => {
    resetConsole();
    resetNetwork();
    resetJavaScript();
    window.document.body.innerHTML = '';
  });

  describe('environment', () => {
    test('captures URL, title, browser, platform, viewport, timestamp', () => {
      const env = collectEnvironment();
      assert.equal(env.url, 'https://example.com/test-page');
      assert.equal(env.title, 'TestPage');
      assert.ok(env.browser.length > 0);
      assert.ok(typeof env.platform === 'string');
      assert.ok(env.viewport.width > 0);
      assert.ok(env.viewport.height > 0);
      assert.ok(env.timestamp > 0);
    });
  });

  describe('console collector', () => {
    test('captures console.error and console.warn with stack', () => {
      startConsoleCollector();
      console.error('Test error: { "db": "prod" }');
      console.warn('Test warning');
      const entries = collectConsole();
      assert.equal(entries.length, 2);
      assert.equal(entries[0].level, 'error');
      assert.equal(entries[0].message, 'Test error: { "db": "prod" }');
      assert.ok(entries[0].stack);
      assert.equal(entries[1].level, 'warn');
      assert.ok(entries[1].stack);
    });

    test('captures console.log with object args', () => {
      startConsoleCollector();
      console.log('Status:', { code: 500, message: 'boom' });
      const entries = collectConsole();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].level, 'log');
      assert.ok(entries[0].message.includes('Status:'));
      assert.ok(entries[0].message.includes('500'));
    });
  });

  describe('network collector', () => {
    function setFetchMock(mock: (...args: unknown[]) => Promise<Response>): void {
      Object.defineProperty(window, 'fetch', {
        value: mock,
        writable: true,
        configurable: true,
      });
    }

    test('captures failed fetch (404) with response preview', async () => {
      setFetchMock(async () => new Response('Not Found', { status: 404 }));
      startNetworkCollector();

      await window.fetch('https://api.example.com/missing-api');
      const entries = collectNetwork();
      assert.equal(entries.length, 1);
      const entry = entries[0] as NetworkEntry;
      assert.equal(entry.url, 'https://api.example.com/missing-api');
      assert.equal(entry.method, 'GET');
      assert.equal(entry.status, 404);
      assert.equal(entry.responsePreview, 'Not Found');
      assert.ok(entry.duration >= 0);
    });

    test('does not capture successful requests', async () => {
      setFetchMock(async () => new Response('ok', { status: 200 }));
      startNetworkCollector();
      await window.fetch('https://api.example.com/healthy');
      const entries = collectNetwork();
      assert.equal(entries.length, 0);
    });

    test('XHR wrapping tracks method, url, and headers from open/setRequestHeader', () => {
      startNetworkCollector();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.example.com/submit');
      xhr.setRequestHeader('Content-Type', 'application/json');
      assert.equal((xhr as any).__ds_method, 'POST');
      assert.equal((xhr as any).__ds_url, 'https://api.example.com/submit');
      assert.equal((xhr as any).__ds_headers['Content-Type'], 'application/json');
    });
  });

  describe('javascript collector', () => {
    test('captures unhandled exceptions', () => {
      startJavaScriptCollector();
      const err = new Error('DEVSnitcher test: unhandled exception');
      err.stack = 'Error: DEVSnitcher test: unhandled exception\n    at test (page.js:10:5)';
      const ev = new ErrorEvent('error', {
        message: 'DEVSnitcher test: unhandled exception',
        filename: 'page.js',
        lineno: 10,
        colno: 5,
        error: err,
      });
      window.dispatchEvent(ev);
      const entries = collectJavaScript();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'unhandled_exception');
      assert.equal(entries[0].message, 'DEVSnitcher test: unhandled exception');
      assert.equal(entries[0].filename, 'page.js');
      assert.equal(entries[0].lineno, 10);
    });

    test('captures unhandled promise rejections', () => {
      startJavaScriptCollector();
      const p = Promise.reject(new Error('DEVSnitcher test: unhandled promise rejection'));
      p.catch(() => {});
      const ev = new PromiseRejectionEvent('unhandledrejection', {
        promise: p,
        reason: new Error('DEVSnitcher test: unhandled promise rejection'),
      });
      window.dispatchEvent(ev);
      const entries = collectJavaScript();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'promise_rejection');
      assert.ok(entries[0].message.includes('unhandled promise rejection'));
    });
  });

  describe('dom collector', () => {
    test('captures selected element with selector, html, classes', () => {
      const div = window.document.createElement('div');
      div.id = 'test-el';
      div.className = 'container active';
      div.innerHTML = '<span>Hello</span>';
      window.document.body.appendChild(div);

      const ctx = collectDom(div);
      assert.ok(ctx);
      assert.equal(ctx!.selector, '#test-el');
      assert.equal(ctx!.tagName, 'div');
      assert.equal(ctx!.className, 'container active');
      assert.equal(ctx!.isFocused, false);
    });

    test('falls back to active element when no selection provided', () => {
      // When no element is selected, collectDom falls back to document.activeElement
      const ctx = collectDom(null);
      assert.ok(ctx);
      assert.ok(ctx!.selector.length > 0);
    });

    test('builds unique selectors for siblings under an ID ancestor', () => {
      const container = window.document.createElement('div');
      container.id = 'menu';
      const a = window.document.createElement('div');
      const b = window.document.createElement('div');
      const c = window.document.createElement('div');
      a.className = 'item';
      b.className = 'item';
      c.className = 'item';
      container.appendChild(a);
      container.appendChild(b);
      container.appendChild(c);
      window.document.body.appendChild(container);

      const sa = collectDom(a)!.selector;
      const sb = collectDom(b)!.selector;
      const sc = collectDom(c)!.selector;
      assert.equal(sa, '#menu > div:nth-of-type(1)');
      assert.equal(sb, '#menu > div:nth-of-type(2)');
      assert.equal(sc, '#menu > div:nth-of-type(3)');
      assert.notEqual(sa, sb);
      assert.notEqual(sb, sc);
    });

    test('builds unique selectors for nested elements of the same tag', () => {
      const outer = window.document.createElement('section');
      const inner = window.document.createElement('div');
      const p1 = window.document.createElement('p');
      const p2 = window.document.createElement('p');
      inner.appendChild(p1);
      inner.appendChild(p2);
      outer.appendChild(inner);
      window.document.body.appendChild(outer);

      const s1 = collectDom(p1)!.selector;
      const s2 = collectDom(p2)!.selector;
      assert.ok(s1.includes('p:nth-of-type(1)'));
      assert.ok(s2.includes('p:nth-of-type(2)'));
      assert.notEqual(s1, s2);
    });
  });

  describe('screenshot', () => {
    test('returns data URL from chrome.tabs.captureVisibleTab', async () => {
      const result = await captureScreenshot();
      assert.ok(result);
      assert.ok(result?.dataUrl.startsWith('data:image/'));
    });

    test('populates width and height from decoded image', async () => {
      const result = await captureScreenshot();
      assert.ok(result);
      assert.equal(result?.width, 1280);
      assert.equal(result?.height, 720);
    });
  });
});

describe('redaction', () => {
  const evidence: Evidence = {
    environment: collectEnvironment(),
    console: [
      { level: 'error', message: 'Auth failed: password=secret123 token=bearer_abc', timestamp: 100 },
    ],
    network: [
      {
        url: 'https://api.example.com/data?token=sk-1234567890abcdef',
        method: 'GET',
        status: 401,
        duration: 42,
        responsePreview: '{"error": "Unauthorized", "Authorization": "Bearer xyz789"}',
        requestHeaders: {
          Authorization: 'Bearer abc123',
          'X-API-Key': 'key_99999',
          Cookie: 'session=abc123; jwt=eyJhbGc',
          Accept: 'application/json',
        },
      },
    ],
    jsErrors: [
      {
        type: 'unhandled_exception',
        message: 'Bearer abc123 token here',
        stack: 'at foo (api.js:1:1)',
      },
    ],
    dom: {
      selector: '#test',
      html: '<div>password=pwd123</div>',
      className: '',
      tagName: 'div',
      isFocused: false,
    },
    screenshot: null,
  };

  test('redacts authorization headers, bearer tokens, API keys, cookies', () => {
    const redacted = redactEvidence(evidence);
    const headers = redacted.network[0].requestHeaders;
    assert.equal(headers.Authorization, '[REDACTED]');
    assert.equal(headers['X-API-Key'], '[REDACTED]');
    assert.equal(headers.Cookie, '[REDACTED]');
    assert.equal(headers.Accept, 'application/json');
  });

  test('redacts sensitive query params in URL', () => {
    const redacted = redactEvidence(evidence);
    assert.ok(!redacted.network[0].url.includes('sk-1234567890abcdef'));
    assert.ok(redacted.network[0].url.includes('[REDACTED]'));
  });

  test('redacts bearer tokens in response preview', () => {
    const redacted = redactEvidence(evidence);
    assert.ok(!redacted.network[0].responsePreview.includes('xyz789'));
  });

  test('redacts secrets in console messages and DOM html', () => {
    const redacted = redactEvidence(evidence);
    assert.ok(!redacted.console[0].message.includes('secret123'));
    assert.ok(!redacted.dom!.html.includes('pwd123'));
  });

  test('does not redact non-sensitive data', () => {
    const safe: Evidence = {
      environment: collectEnvironment(),
      console: [{ level: 'log', message: 'User clicked button', timestamp: 100 }],
      network: [
        {
          url: 'https://api.example.com/users?page=2',
          method: 'GET',
          status: 200,
          duration: 10,
          responsePreview: '{"id": 1, "name": "Alice"}',
          requestHeaders: { Accept: 'application/json' },
        },
      ],
      jsErrors: [],
      dom: null,
      screenshot: null,
    };
    const redacted = redactEvidence(safe);
    assert.equal(redacted.console[0].message, 'User clicked button');
    assert.equal(redacted.network[0].url, 'https://api.example.com/users?page=2');
    assert.equal(redacted.network[0].responsePreview, '{"id": 1, "name": "Alice"}');
  });

  test('redacts bearer tokens and URL query tokens in stack traces', () => {
    const redacted = redactEvidence({
      ...evidence,
      console: [
        {
          level: 'error',
          message: 'boom',
          timestamp: 100,
          stack: 'Error: boom\n    at fetch (https://api.example.com/data?token=sk-1234567890abcdef:10:5)\n    at getData (app.js:20:10)',
        },
      ],
      jsErrors: [
        {
          type: 'unhandled_exception' as const,
          message: 'boom',
          stack: 'Error: boom\n    at api (https://api.example.com/auth?access_token=abc123secret:1:1)',
        },
      ],
    });

    assert.ok(redacted.console[0].stack);
    assert.ok(!redacted.console[0].stack!.includes('sk-1234567890abcdef'));
    assert.ok(!redacted.jsErrors[0].stack!.includes('abc123secret'));
    assert.ok(redacted.console[0].stack!.includes('[REDACTED]'));
    assert.ok(redacted.jsErrors[0].stack!.includes('[REDACTED]'));
  });

  test('redacts tokens inside URLs embedded in response previews', () => {
    const redacted = redactEvidence({
      ...evidence,
      network: [
        {
          ...evidence.network[0],
          responsePreview:
            '{"url": "https://api.example.com/data?token=sk-secret789", "msg": "ok"}',
        },
      ],
    });

    assert.ok(!redacted.network[0].responsePreview.includes('sk-secret789'));
    assert.ok(redacted.network[0].responsePreview.includes('[REDACTED]'));
  });

  test('redactCookieString redacts sensitive cookies but keeps benign ones', () => {
    const result = redactCookieString('session=abc123; theme=dark; jwt=eyJhbGc; lang=en');
    assert.ok(result.includes('session=[REDACTED]'));
    assert.ok(result.includes('jwt=[REDACTED]'));
    assert.ok(result.includes('theme=dark'));
    assert.ok(result.includes('lang=en'));
  });
});

describe('report builder', () => {
  test('markdown report has all required sections and redaction', () => {
    startConsoleCollector();
    startJavaScriptCollector();
    console.error('DEVSnitcher test: console error');

    const err = new Error('DEVSnitcher test: unhandled exception');
    err.stack = 'Error: DEVSnitcher test: unhandled exception\n    at test (page.js:10:5)';
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'DEVSnitcher test: unhandled exception',
        filename: 'page.js',
        lineno: 10,
        colno: 5,
        error: err,
      }),
    );

    const evidence: Evidence = {
      environment: collectEnvironment(),
      console: collectConsole(),
      network: [
        {
          url: 'https://api.example.com/missing',
          method: 'GET',
          status: 404,
          duration: 50,
          responsePreview: 'Not Found',
          requestHeaders: { Authorization: 'Bearer abc123' },
        },
      ],
      jsErrors: collectJavaScript(),
      dom: {
        selector: '#test',
        html: '<div>Test</div>',
        className: 'test',
        tagName: 'div',
        isFocused: false,
      },
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 100, height: 100 },
    };

    const redacted = redactEvidence(evidence);
    const report = buildMarkdownReport({
      evidence: redacted,
      userNotes: 'Clicked Save. Nothing happened.',
    });

    assert.ok(report.includes('# DEVSNITCHER REPORT'));
    assert.ok(report.includes('## User Description'));
    assert.ok(report.includes('Clicked Save. Nothing happened.'));
    assert.ok(report.includes('## Environment'));
    assert.ok(report.includes('https://example.com/test-page'));
    assert.ok(report.includes('## Console'));
    assert.ok(report.includes('console error'));
    assert.ok(report.includes('## Network'));
    assert.ok(report.includes('api.example.com/missing'));
    assert.ok(report.includes('404'));
    assert.ok(report.includes('## JavaScript'));
    assert.ok(report.includes('unhandled exception'));
    assert.ok(report.includes('## DOM Context'));
    assert.ok(report.includes('#test'));
    assert.ok(report.includes('## Screenshot'));
    assert.ok(report.includes('Attached'));
    assert.ok(report.includes('## Summary'));
    // Redaction in report
    assert.ok(!report.includes('Bearer abc123'));
    assert.ok(report.includes('[REDACTED]'));
  });

  test('JSON report has correct schema and structure', () => {
    const evidence: Evidence = {
      environment: collectEnvironment(),
      console: [{ level: 'error', message: 'fail', timestamp: 100 }],
      network: [
        {
          url: 'https://x.com',
          method: 'GET',
          status: 0,
          duration: 1,
          responsePreview: '',
          requestHeaders: {},
        },
      ],
      jsErrors: [{ type: 'promise_rejection', message: 'oops', stack: '' }],
      dom: null,
      screenshot: null,
    };
    const report = buildJsonReport({ evidence, userNotes: 'Test' });
    const parsed = JSON.parse(report);
    assert.equal(parsed.schema, 'devsnitcher/v1');
    assert.equal(parsed.userDescription, 'Test');
    assert.ok(parsed.evidence);
    assert.ok(parsed.summary);
    assert.equal(parsed.summary.failedRequests, 1);
    assert.equal(parsed.summary.unhandledErrors, 1);
  });
});

describe('encrypted evidence cache', () => {
  const SECRET_MARKER = 'secret-token-abc123';
  const PAGE_URL = 'https://example.com/test-page';

  function makeEvidence(url = PAGE_URL): Evidence {
    return {
      environment: {
        url,
        title: 'TestPage',
        browser: 'TestBrowser',
        platform: 'test',
        viewport: { width: 1280, height: 720 },
        timestamp: 1234567890,
      },
      console: [{ level: 'error', message: `boom ${SECRET_MARKER}`, timestamp: 1 }],
      network: [],
      jsErrors: [],
      dom: null,
      screenshot: null,
    };
  }

  async function makeCache() {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const dump = new Map<string, unknown>();
    const storage: SessionStorageLike = {
      get: async (name) => (dump.has(name) ? { [name]: dump.get(name) } : {}),
      set: async (items) => {
        for (const [k, v] of Object.entries(items)) dump.set(k, v);
      },
      remove: async (name) => {
        dump.delete(name);
      },
    };
    return { dump, cache: new EvidenceCache(storage, () => Promise.resolve(key)) };
  }

  test('round-trip: SNITCH can consume a valid encrypted cached record', async () => {
    const { cache } = await makeCache();
    const original = makeEvidence();

    await cache.store(1, PAGE_URL, original);
    const loaded = await cache.load(1, PAGE_URL);

    assert.equal(loaded.environment.url, original.environment.url);
    assert.equal(loaded.environment.title, original.environment.title);
    assert.deepEqual(loaded.console, original.console);
  });

  test('stored cache representation is ciphertext, not plaintext evidence', async () => {
    const { dump, cache } = await makeCache();

    await cache.store(1, PAGE_URL, makeEvidence());

    const record = dump.get(cacheRecordKey(1)) as Record<string, unknown>;
    assert.equal(record.version, 1);
    assert.equal(record.url, PAGE_URL);
    assert.equal(typeof record.capturedAt, 'number');
    assert.equal(typeof record.iv, 'string');
    assert.equal(typeof record.ciphertext, 'string');

    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(SECRET_MARKER));
    assert.ok(!serialized.includes('"environment"'));
    assert.ok(!serialized.includes('TestPage'));
  });

  test('each cache write uses a fresh random IV', async () => {
    const { dump, cache } = await makeCache();

    await cache.store(1, PAGE_URL, makeEvidence());
    const firstIv = (dump.get(cacheRecordKey(1)) as Record<string, unknown>).iv;
    await cache.store(1, PAGE_URL, makeEvidence());
    const secondIv = (dump.get(cacheRecordKey(1)) as Record<string, unknown>).iv;

    assert.notEqual(firstIv, secondIv);
  });

  test('altered ciphertext fails authentication', async () => {
    const { dump, cache } = await makeCache();

    await cache.store(1, PAGE_URL, makeEvidence());
    const record = dump.get(cacheRecordKey(1)) as Record<string, unknown>;
    const bytes = atob(record.ciphertext as string);
    record.ciphertext = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 0x01) + bytes.slice(1));

    await assert.rejects(() => cache.load(1, PAGE_URL));
  });

  test('altered IV fails authentication', async () => {
    const { dump, cache } = await makeCache();

    await cache.store(1, PAGE_URL, makeEvidence());
    const record = dump.get(cacheRecordKey(1)) as Record<string, unknown>;
    const ivBytes = atob(record.iv as string);
    record.iv = btoa(String.fromCharCode(ivBytes.charCodeAt(0) ^ 0x01) + ivBytes.slice(1));

    await assert.rejects(() => cache.load(1, PAGE_URL));
  });

  test('a record bound to one tab cannot be accepted for another tab', async () => {
    const { dump, cache } = await makeCache();

    await cache.store(1, PAGE_URL, makeEvidence());

    // Copy tab 1's record verbatim into tab 2's storage slot.
    dump.set(cacheRecordKey(2), dump.get(cacheRecordKey(1)));

    await assert.rejects(() => cache.load(2, PAGE_URL));
    assert.ok(await cache.load(1, PAGE_URL));
  });

  test('cached evidence for a stale page URL is not used', async () => {
    const stale = await makeCache();
    await stale.cache.store(1, 'https://example.com/page-a', makeEvidence('https://example.com/page-a'));
    await assert.rejects(() => stale.cache.load(1, 'https://example.com/page-b'));
    assert.equal(stale.dump.has(cacheRecordKey(1)), false);

    const fresh = await makeCache();
    await fresh.cache.store(1, 'https://example.com/page-a', makeEvidence('https://example.com/page-a'));
    assert.ok(await fresh.cache.load(1, 'https://example.com/page-a'));
  });

  test('malformed cache-write payloads are rejected, not coerced', async () => {
    const { cache } = await makeCache();

    assert.equal(isEvidenceShape(null), false);
    assert.equal(isEvidenceShape('evidence'), false);
    assert.equal(isEvidenceShape({}), false);
    assert.equal(isEvidenceShape({ environment: { url: 'x', title: 't', timestamp: 1 } }), false);
    assert.equal(
      isEvidenceShape({
        environment: { url: 'x', title: 't', timestamp: 1 },
        console: 'not-an-array',
        network: [],
        jsErrors: [],
        dom: null,
        screenshot: null,
      }),
      false,
    );

    await assert.rejects(() => cache.store(1, PAGE_URL, 'not evidence' as unknown as Evidence));
    await assert.rejects(() => cache.store(1, PAGE_URL, {} as unknown as Evidence));
    await assert.rejects(() => cache.load(1, PAGE_URL));
  });

  test('loading with no cache record fails cleanly', async () => {
    const { cache } = await makeCache();

    await assert.rejects(() => cache.load(42, PAGE_URL));
  });
});

describe('DEVPEEPER Chrome-mediated bounded observation', () => {
  test('bounded probe returns plain serializable data without a postMessage transport', () => {
    const source = snapshotProbe.toString();
    assert.ok(!source.includes('postMessage'), 'probe must not use window.postMessage');

    const snapshot = snapshotProbe();
    assert.ok(snapshot.environment);
    assert.equal(typeof snapshot.environment.url, 'string');
    assert.equal(typeof snapshot.environment.title, 'string');
    assert.equal(typeof snapshot.environment.browser, 'string');
    assert.equal(typeof snapshot.environment.platform, 'string');
    assert.equal(typeof snapshot.environment.viewport.width, 'number');
    assert.equal(typeof snapshot.environment.viewport.height, 'number');

    // Round-trips through JSON, so Chrome can serialize it back to the extension.
    const serialized = JSON.parse(JSON.stringify(snapshot)) as BoundedSnapshot;
    assert.deepEqual(serialized, snapshot);
  });

  test('Chrome-mediated snapshot normalizes into EnvironmentInfo and DomContext', () => {
    const snapshot: BoundedSnapshot = {
      environment: {
        url: 'https://example.com/page',
        title: 'Page',
        browser: 'Chrome',
        platform: 'Win32',
        viewport: { width: 1280, height: 720 },
      },
      dom: {
        selector: 'html > body > form > input#name',
        html: '<input id="name" value="x">',
        className: 'field',
        tagName: 'input',
        isFocused: true,
      },
    };

    const normalized = normalizeBoundedSnapshot(snapshot, 1700000000123);
    assert.equal(normalized.environment.url, snapshot.environment.url);
    assert.equal(normalized.environment.title, snapshot.environment.title);
    assert.equal(normalized.environment.browser, snapshot.environment.browser);
    assert.equal(normalized.environment.platform, snapshot.environment.platform);
    assert.deepEqual(normalized.environment.viewport, snapshot.environment.viewport);
    assert.equal(normalized.environment.timestamp, 1700000000123);
    assert.deepEqual(normalized.dom, snapshot.dom);
  });

  test('observation envelope separates payload, acquisition and browser provenance', () => {
    const snapshot = snapshotProbe();
    const result: InjectionResultLike = { frameId: 0, documentId: 'abc-doc' };
    const observation = makeBoundedObservation(snapshot, result, 7, 1700000000123);

    assert.equal(observation.acquisition, 'chrome-scripting');
    assert.equal(observation.provenance.tabId, 7);
    assert.equal(observation.provenance.frameId, 0);
    assert.equal(observation.provenance.documentId, 'abc-doc');
    assert.deepEqual(observation.payload, normalizeBoundedSnapshot(snapshot, 1700000000123));
  });

  test('observation envelope does not invent absent browser identities', () => {
    const snapshot = snapshotProbe();
    const result: InjectionResultLike = { frameId: 0 };
    const observation = makeBoundedObservation(snapshot, result, 3, 0);

    assert.equal(observation.provenance.tabId, 3);
    assert.equal(observation.provenance.frameId, 0);
    assert.equal(observation.provenance.documentId, undefined);
    assert.equal(observation.provenance.worldId, undefined);
  });
});

describe('DEVPEEPER Chromium observation foundation', () => {
  interface MockTransport extends DebuggerTransport {
    attachCalls: Array<{ target: DebuggerTarget; version: string }>;
    detachCalls: Array<DebuggerTarget>;
    commands: Array<{ method: string; params?: unknown }>;
    emitEvent(target: DebuggerTarget, method: string, params?: unknown): void;
    emitDetach(target: DebuggerTarget, reason: string): void;
  }

  function makeTransport(): MockTransport {
    const eventListeners: Array<
      (target: DebuggerTarget, method: string, params?: unknown) => void
    > = [];
    const detachListeners: Array<(target: DebuggerTarget, reason: string) => void> = [];

    const transport: MockTransport = {
      attachCalls: [],
      detachCalls: [],
      commands: [],
      attach: async (target, version) => {
        transport.attachCalls.push({ target, version });
      },
      detach: async (target) => {
        transport.detachCalls.push(target);
      },
      sendCommand: async (_target, method, params) => {
        transport.commands.push({ method, params });
        return {};
      },
      onEvent(listener) {
        eventListeners.push(listener);
        return () => {
          const i = eventListeners.indexOf(listener);
          if (i >= 0) eventListeners.splice(i, 1);
        };
      },
      onDetach(listener) {
        detachListeners.push(listener);
        return () => {
          const i = detachListeners.indexOf(listener);
          if (i >= 0) detachListeners.splice(i, 1);
        };
      },
      emitEvent(target, method, params) {
        for (const l of [...eventListeners]) l(target, method, params);
      },
      emitDetach(target, reason) {
        for (const l of [...detachListeners]) l(target, reason);
      },
    };

    return transport;
  }

  test('lifecycle: not running until start, running after start, stopped after stop', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(5, transport);

    assert.equal(observer.isRunning(), false);
    await observer.start();
    assert.equal(observer.isRunning(), true);
    await observer.stop();
    assert.equal(observer.isRunning(), false);
  });

  test('start attaches to the bound tab and enables only the minimal Page domain', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(9, transport);

    await observer.start();

    assert.equal(transport.attachCalls.length, 1);
    assert.deepEqual(transport.attachCalls[0].target, { tabId: 9 });
    assert.ok(transport.attachCalls[0].version.length > 0);

    assert.deepEqual(
      transport.commands.map((c) => c.method),
      ['Page.enable'],
    );
  });

  test('accepts instrumentation only for the active attachment tab', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    // Event for a different tab is ignored.
    transport.emitEvent({ tabId: 99 }, 'Page.frameNavigated', {
      frame: { id: 0, loaderId: 'other-loader' },
    });
    assert.equal(observer.drain().length, 0);

    transport.emitEvent({ tabId: 3 }, 'Page.frameNavigated', {
      frame: { id: 0, loaderId: 'loader-1' },
      timestamp: 1700000000000,
    });
    const buffered = observer.drain();
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0].provenance.tabId, 3);
  });

  test('preserves browser provenance on a browser-observed observation', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(7, transport);
    await observer.start();

    transport.emitEvent({ tabId: 7 }, 'Page.frameNavigated', {
      frame: { id: 11, loaderId: 'loader-abc' },
      timestamp: 1700000000000,
    });
    transport.emitEvent({ tabId: 7 }, 'Page.frameNavigated', {
      frame: { id: 11, loaderId: 'loader-abc' },
      timestamp: 1700000000999,
    });

    const drained = observer.poll();
    assert.equal(drained.length, 2);
    for (const observation of drained) {
      assert.equal(observation.acquisition, 'chrome-debugger');
      assert.equal(observation.method, 'Page.frameNavigated');
      assert.equal(observation.provenance.tabId, 7);
      assert.equal(observation.provenance.frameId, 11);
      assert.equal(observation.provenance.loaderId, 'loader-abc');
      assert.equal(typeof observation.provenance.timestamp, 'number');
    }
  });

  test('only recognized foundation events are elevated to observations', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(4, transport);
    await observer.start();

    transport.emitEvent({ tabId: 4 }, 'Page.someOtherEvent', { foo: 1 });
    assert.equal(observer.drain().length, 0);

    transport.emitEvent({ tabId: 4 }, 'Page.frameNavigated', {
      frame: { id: 0, loaderId: 'l' },
    });
    assert.equal(observer.drain().length, 1);
  });

  test('Chrome-initiated detach stops the observer and clears stale observations', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(6, transport);
    await observer.start();

    transport.emitEvent({ tabId: 6 }, 'Page.frameNavigated', {
      frame: { id: 0, loaderId: 'l' },
    });
    assert.equal(observer.isRunning(), true);

    transport.emitDetach({ tabId: 6 }, 'target_closed');
    assert.equal(observer.isRunning(), false);
    assert.equal(observer.drain().length, 0);
  });

  test('detach from a different tab is ignored', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(6, transport);
    await observer.start();

    transport.emitDetach({ tabId: 999 }, 'target_closed');
    assert.equal(observer.isRunning(), true);
  });

  test('stop detaches cleanly and a detach error does not break the caller', async () => {
    const transport = makeTransport();
    transport.detach = async (target) => {
      transport.detachCalls.push(target);
      throw new Error('already detached');
    };
    const observer = new ChromiumObserver(2, transport);

    await observer.start();
    await observer.stop();
    assert.equal(observer.isRunning(), false);
    assert.equal(transport.detachCalls.length, 1);
  });
});
