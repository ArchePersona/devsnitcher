import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { captureScreenshot } from '../collectors/screenshot';
import {
  redactEvidence,
  redactCookieString,
  redactConsoleEntry,
  redactJsErrorEntry,
  redactDomContext,
  redactUrl,
} from '../redaction/index';
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
import { ActiveTabObserverController } from '../devpeeper/active-observer';
import type { DebuggerTarget, DebuggerTransport } from '../devpeeper/debugger-transport';
import { normalizeConsoleApi, normalizeExceptionThrown } from '../devpeeper/runtime-normalizer';
import type { Evidence } from '../shared/types';

describe('DEVSnitcher collectors', () => {
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
    environment: {
      url: 'https://example.com',
      title: 'Test',
      browser: 'Chrome',
      platform: 'Win32',
      viewport: { width: 1280, height: 720 },
      timestamp: 0,
    },
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
      environment: {
      url: 'https://example.com',
      title: 'Test',
      browser: 'Chrome',
      platform: 'Win32',
      viewport: { width: 1280, height: 720 },
      timestamp: 0,
    },
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

  test('console, DOM HTML and JS error messages redact URL query secrets (BUG 3)', () => {
    const consoleEntry = redactConsoleEntry({
      level: 'log',
      message: 'GET https://api.example.com/data?token=secret123',
      timestamp: 1,
    });
    assert.ok(consoleEntry.message.includes('token=[REDACTED]'));
    assert.ok(!consoleEntry.message.includes('secret123'));

    const dom = redactDomContext({
      selector: 'div',
      tagName: 'DIV',
      className: 'x',
      isFocused: false,
      html: '<a href="https://api.example.com/x?access_token=abc123">go</a>',
    });
    assert.ok(dom.html.includes('access_token=[REDACTED]'));
    assert.ok(!dom.html.includes('abc123'));

    const jsError = redactJsErrorEntry({
      type: 'unhandled_exception',
      message: 'failed to load https://api.example.com/y?password=hunter2',
      stack: 'at fn (https://api.example.com/z?code=qwerty)',
    });
    assert.ok(jsError.message.includes('password=[REDACTED]'));
    assert.ok(!jsError.message.includes('hunter2'));
    assert.ok(jsError.stack.includes('code=[REDACTED]'));
    assert.ok(!jsError.stack.includes('qwerty'));
  });

  test('sensitive fragment parameters are redacted, safe fragments preserved (BUG 4)', () => {
    assert.equal(
      redactUrl('https://x.test/path#access_token=secret').url,
      'https://x.test/path#access_token=[REDACTED]',
    );
    assert.equal(
      redactUrl('https://x.test/path#token=abc&state=xyz').url,
      'https://x.test/path#token=[REDACTED]&state=xyz',
    );
    assert.equal(
      redactUrl('https://x.test/path#foo=bar&sid=1').url,
      'https://x.test/path#foo=bar&sid=[REDACTED]',
    );
    assert.equal(
      redactUrl('https://x.test/path#section-name').url,
      'https://x.test/path#section-name',
    );
    assert.equal(
      redactUrl('https://x.test/path?a=1#token=zzz').url,
      'https://x.test/path?a=1#token=[REDACTED]',
    );
    assert.equal(
      redactUrl('https://x.test/path#plain=value').url,
      'https://x.test/path#plain=value',
    );
  });

  test('fragment redaction preserves encoded safe values byte-for-byte (BUG A)', () => {
    // Percent-encoding of non-sensitive fragment values is never de-encoded.
    assert.equal(
      redactUrl('https://x.test/path#token=z&continue=https%3A%2F%2Fevil.com').url,
      'https://x.test/path#token=[REDACTED]&continue=https%3A%2F%2Fevil.com',
    );
    // %26 inside a value must not be re-interpreted as a parameter separator.
    assert.equal(
      redactUrl('https://x.test/path#foo=a%26b&token=z').url,
      'https://x.test/path#foo=a%26b&token=[REDACTED]',
    );
    // %20 inside a value must remain encoded.
    assert.equal(
      redactUrl('https://x.test/path#msg=hello%20world&sid=9').url,
      'https://x.test/path#msg=hello%20world&sid=[REDACTED]',
    );
    // Mixed sensitive/non-sensitive params: safe values untouched, in order.
    assert.equal(
      redactUrl('https://x.test/path#state=xyz&next=c%26b&code=z&q=1%202').url,
      'https://x.test/path#state=xyz&next=c%26b&code=[REDACTED]&q=1%202',
    );
    // Ordinary anchors (no `=`) remain unchanged even alongside sensitive params.
    assert.equal(
      redactUrl('https://x.test/path#features.top=1&section-name&token=z').url,
      'https://x.test/path#features.top=1&section-name&token=[REDACTED]',
    );
  });

  test('query redaction preserves encoded safe values without double-encoding (BUG B)', () => {
    // Encoded redirect URL remains byte-for-byte unchanged when a neighbor redacts.
    assert.equal(
      redactUrl('https://x.test/path?redirect=https%3A%2F%2Fevil.com&token=z').url,
      'https://x.test/path?redirect=https%3A%2F%2Fevil.com&token=[REDACTED]',
    );
    // %26 and %20 stay encoded, not re-encoded or decoded.
    assert.equal(
      redactUrl('https://x.test/path?x=%26y&msg=a%20b&token=z').url,
      'https://x.test/path?x=%26y&msg=a%20b&token=[REDACTED]',
    );
    // Duplicate safe params remain present and ordered.
    assert.equal(
      redactUrl('https://x.test/path?a=1&a=2&token=z').url,
      'https://x.test/path?a=1&a=2&token=[REDACTED]',
    );
    // A query with no fragment must not gain a trailing `#`.
    assert.equal(
      redactUrl('https://x.test/path?token=z').url,
      'https://x.test/path?token=[REDACTED]',
    );
    // Sensitive values are redacted.
    assert.equal(
      redactUrl('https://api.example.com/data?token=sk-1234567890abcdef').url,
      'https://api.example.com/data?token=[REDACTED]',
    );
  });
});

describe('report builder', () => {
  test('markdown report has all required sections and redaction', () => {
    const evidence: Evidence = {
      environment: {
        url: 'https://example.com/test-page',
        title: 'Test',
        browser: 'Chrome',
        platform: 'Win32',
        viewport: { width: 1280, height: 720 },
        timestamp: 0,
      },
      console: [{ level: 'error', message: 'DEVSnitcher test: console error', timestamp: 100 }],
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
      jsErrors: [
        {
          type: 'unhandled_exception',
          message: 'DEVSnitcher test: unhandled exception',
          stack: '',
        },
      ],
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
      environment: {
        url: 'https://example.com',
        title: 'Test',
        browser: 'Chrome',
        platform: 'Win32',
        viewport: { width: 1280, height: 720 },
        timestamp: 0,
      },
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

  test('bounded probe executes in the trusted background, not the content bundle', () => {
    // chrome.scripting is not available to content-script contexts: it is
    // undefined there, so a content script calling chrome.scripting.executeScript
    // throws "Cannot read properties of undefined (reading 'executeScript')".
    // The DEVPEEPER bounded probe must therefore be run from the background
    // service worker. Guard that the content bridge never references the API.
    const root = process.cwd();
    const contentSource = readFileSync(join(root, 'extension', 'content', 'index.ts'), 'utf8');
    const backgroundSource = readFileSync(
      join(root, 'extension', 'background', 'index.ts'),
      'utf8',
    );

    assert.ok(
      !contentSource.includes('chrome.scripting.executeScript'),
      'content bridge must not call chrome.scripting (unavailable in content scripts)',
    );
    assert.ok(
      backgroundSource.includes('chrome.scripting'),
      'background must own the chrome.scripting bounded-probe execution',
    );
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

  test('start attaches to the bound tab and enables only the minimal domains', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(9, transport);

    await observer.start();

    assert.equal(transport.attachCalls.length, 1);
    assert.deepEqual(transport.attachCalls[0].target, { tabId: 9 });
    assert.ok(transport.attachCalls[0].version.length > 0);

    assert.deepEqual(
      transport.commands.map((c) => c.method),
      ['Page.enable', 'Runtime.enable', 'Network.enable'],
    );
  });

  test('transactional start: partial enable failure detaches, unsubscribes, and stays reusable', async () => {
    const detachCalls: DebuggerTarget[] = [];
    let subscribed = 0;
    let unsubscribed = 0;
    const failOn = new Set<string>(['Runtime.enable']);

    const transport: DebuggerTransport = {
      attach: async () => undefined,
      detach: async (target) => {
        detachCalls.push(target);
      },
      sendCommand: async (_target, method) => {
        if (failOn.has(method)) throw new Error(`enable failed: ${method}`);
        return {};
      },
      onEvent: () => {
        subscribed += 1;
        return () => {
          unsubscribed += 1;
        };
      },
      onDetach: () => {
        subscribed += 1;
        return () => {
          unsubscribed += 1;
        };
      },
    };

    const observer = new ChromiumObserver(5, transport);

    // First start fails part-way through enabling domains.
    await assert.rejects(() => observer.start(), /enable failed: Runtime\.enable/);
    assert.equal(observer.isRunning(), false, 'observer must not be running after failed start');
    assert.equal(detachCalls.length, 1, 'failed start must detach the debugger target');
    assert.deepEqual(detachCalls[0], { tabId: 5 });
    assert.equal(
      subscribed - unsubscribed,
      0,
      'all listeners from the failed attempt must be unsubscribed',
    );

    // A retry must not accumulate more active listeners than a clean start.
    await assert.rejects(() => observer.start(), /enable failed: Runtime\.enable/);
    assert.equal(observer.isRunning(), false);
    assert.equal(detachCalls.length, 2, 'each failed attempt detaches again (reusable)');
    assert.equal(
      subscribed - unsubscribed,
      0,
      'retry must not double the active listener count',
    );
  });

  test('detach during startup invalidates the attempt and start() finishes non-running (BUG D)', async () => {
    const detachCalls: DebuggerTarget[] = [];
    const detachListeners: Array<(target: DebuggerTarget, reason: string) => void> = [];
    let releaseEnable: (() => void) | null = null;
    const enableGate = new Promise<void>((resolve) => {
      releaseEnable = resolve;
    });

    const transport: DebuggerTransport = {
      attach: async () => undefined,
      detach: async (target) => {
        detachCalls.push(target);
      },
      sendCommand: async (_target, method) => {
        if (method === 'Runtime.enable') await enableGate; // hold the enable pending
        return {};
      },
      onEvent: () => () => undefined,
      onDetach: (listener) => {
        detachListeners.push(listener);
        return () => {
          const i = detachListeners.indexOf(listener);
          if (i >= 0) detachListeners.splice(i, 1);
        };
      },
    };

    const observer = new ChromiumObserver(5, transport);

    const startPromise = observer.start();
    // Let start() progress: attach resolves, listeners subscribe, and Page.enable
    // resolves before Runtime.enable blocks on the gate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Fire the matching detach while Runtime.enable is still pending.
    for (const listener of [...detachListeners]) listener({ tabId: 5 }, 'crashed');
    // Now let the pending enable resolve and start() finish.
    releaseEnable!();
    await startPromise;

    assert.equal(
      observer.isRunning(),
      false,
      'a start invalidated by an in-flight detach must not end running',
    );
    assert.equal(
      detachCalls.length,
      0,
      'no second detach is required to correct state after an in-flight detach',
    );

    // A later explicit retry is still possible: the invalidation latch resets.
    await observer.start();
    assert.equal(
      observer.isRunning(),
      true,
      'a retry after an invalidated attempt must be able to start cleanly',
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

describe('DEVPEEPER active-tab observation controller', () => {
  interface MockTransport extends DebuggerTransport {
    attachCalls: DebuggerTarget[];
    detachCalls: DebuggerTarget[];
    attachLatencyMs: number;
    failCommands: Set<string>;
  }

  function makeControllerTransport(): MockTransport {
    const transport: MockTransport = {
      attachCalls: [],
      detachCalls: [],
      attachLatencyMs: 0,
      failCommands: new Set(),
      attach: async (target) => {
        transport.attachCalls.push(target);
        if (transport.attachLatencyMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, transport.attachLatencyMs));
        }
      },
      detach: async (target) => {
        transport.detachCalls.push(target);
      },
      sendCommand: async (_target, method) => {
        if (transport.failCommands.has(method)) throw new Error(`command failed: ${method}`);
        return {};
      },
      onEvent: () => () => undefined,
      onDetach: () => () => undefined,
    };
    return transport;
  }

  function makeController() {
    const transport = makeControllerTransport();
    const controller = new ActiveTabObserverController(() => transport, () => true);
    return { transport, controller };
  }

  test('concurrent activation does not leak multiple debugger attachments', async () => {
    const { transport, controller } = makeController();
    transport.attachLatencyMs = 25;

    // Request tab A, then request tab B before A's startup finishes.
    const first = controller.follow({ id: 1, url: 'https://a.example' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = controller.follow({ id: 2, url: 'https://b.example' });
    await Promise.all([first, second.catch(() => undefined)]);

    // Both tabs were followed, but only one debugger session may remain.
    assert.equal(transport.attachCalls.length, 2);
    assert.equal(transport.detachCalls.length, 1, 'superseded observer must be detached');
    const netAttached = transport.attachCalls.length - transport.detachCalls.length;
    assert.equal(netAttached, 1, 'at most one debugger attachment may remain');

    // The superseded observer (tab A) was the one detached.
    assert.deepEqual(transport.detachCalls[0], { tabId: 1 });

    // The tracked observer corresponds to the latest active tab (B).
    assert.equal(controller.attachedTabId, 2);
    assert.equal(controller.isRunning(), true);
    assert.ok(controller.liveFor(2), 'live observer must be bound to the latest tab');
    assert.equal(controller.liveFor(1), null, 'superseded tab must have no live observer');
  });

  test('following an unsupported tab detaches any current observer', async () => {
    const { transport } = makeController();
    const isSupported = (url: string) => !url.startsWith('chrome://');
    const ctrl = new ActiveTabObserverController(() => transport, isSupported);

    await ctrl.follow({ id: 1, url: 'https://a.example' });
    assert.equal(ctrl.isRunning(), true);

    await ctrl.follow({ id: 3, url: 'chrome://settings' });
    assert.equal(ctrl.attachedTabId, undefined, 'unsupported tab must clear the observer');
    assert.equal(ctrl.isRunning(), false);
    const netAttached = transport.attachCalls.length - transport.detachCalls.length;
    assert.equal(netAttached, 0, 'unsupported transition must detach the prior observer');
  });

  test('failed startup does not leave an untracked observer', async () => {
    const { transport, controller } = makeController();
    transport.failCommands.add('Network.enable');

    await assert.rejects(() => controller.follow({ id: 4, url: 'https://d.example' }));
    assert.equal(controller.attachedTabId, undefined, 'no observer may be tracked after failure');
    assert.equal(controller.isRunning(), false);
    const netAttached = transport.attachCalls.length - transport.detachCalls.length;
    assert.equal(netAttached, 0, 'failed startup must detach (nothing left attached)');
  });

  test('awaiting follow() waits for delayed startup before evidence is readable (BUG C)', async () => {
    const { transport, controller } = makeController();
    transport.attachLatencyMs = 40;

    // A SNITCH-equivalent read must not run before the transition settles: while
    // the follow is still in flight, no evidence is readable from the observer.
    const pending = controller.follow({ id: 7, url: 'https://e.example' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      controller.liveFor(7),
      null,
      'evidence must not be readable while observer startup is still in flight',
    );

    // After the transition settles, the observer is live and evidence is readable.
    await pending;
    assert.ok(
      controller.liveFor(7),
      'awaiting the follow transition yields a live, evidence-ready observer',
    );
    assert.equal(controller.liveFor(7)?.getConsoleEntries().length, 0);
  });
});


describe('DEVPEEPER browser-observed console + runtime errors', () => {
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

  test('start enables Page, Runtime and Network domains', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(1, transport);
    await observer.start();

    const methods = transport.commands.map((c) => c.method);
    assert.ok(methods.includes('Page.enable'));
    assert.ok(methods.includes('Runtime.enable'));
    assert.ok(methods.includes('Network.enable'));
  });

  test('Runtime.consoleAPICalled normalizes supported levels with message and stack', async () => {
    const entry = normalizeConsoleApi({
      type: 'error',
      timestamp: 1700000000.5,
      executionContextId: 12,
      args: [
        { type: 'string', value: 'boom:' },
        { type: 'number', value: 500 },
      ],
      stackTrace: {
        callFrames: [{ functionName: 'fetchData', url: 'app.js', lineNumber: 9, columnNumber: 3 }],
      },
    });

    assert.ok(entry);
    assert.equal(entry!.level, 'error');
    assert.equal(entry!.message, 'boom: 500');
    assert.equal(entry!.timestamp, 1700000000500);
    assert.ok(entry!.stack!.includes('fetchData'));
    assert.ok(entry!.stack!.includes('app.js:10:4'));
  });

  test('console timestamp normalizes seconds to ms and leaves ms unchanged', () => {
    // Unix seconds input is scaled to milliseconds.
    const seconds = normalizeConsoleApi({
      type: 'log',
      timestamp: 1_788_000_000,
      args: [{ type: 'string', value: 'now' }],
    });
    assert.equal(seconds!.timestamp, 1_788_000_000_000);

    // Unix milliseconds input is preserved unchanged (not scaled again).
    const milliseconds = normalizeConsoleApi({
      type: 'log',
      timestamp: 1_788_000_000_000,
      args: [{ type: 'string', value: 'now' }],
    });
    assert.equal(milliseconds!.timestamp, 1_788_000_000_000);
  });

  test('console type mapping and unsupported types are ignored', () => {
    assert.equal(normalizeConsoleApi({ type: 'log', args: [{ type: 'string', value: 'x' }] })!.level, 'log');
    assert.equal(normalizeConsoleApi({ type: 'info', args: [{ type: 'string', value: 'x' }] })!.level, 'info');
    assert.equal(normalizeConsoleApi({ type: 'warning', args: [{ type: 'string', value: 'x' }] })!.level, 'warn');
    assert.equal(normalizeConsoleApi({ type: 'debug', args: [{ type: 'string', value: 'x' }] })!.level, 'debug');
    // Unsupported console types are not elevated.
    assert.equal(normalizeConsoleApi({ type: 'table', args: [{ type: 'string', value: 'x' }] }), null);
    assert.equal(normalizeConsoleApi({ type: 'dir', args: [{ type: 'string', value: 'x' }] }), null);
  });

  test('Runtime.exceptionThrown normalizes without invented promise_rejection type', () => {
    const entry = normalizeExceptionThrown({
      timestamp: 1700000000,
      executionContextId: 5,
      exceptionDetails: {
        exceptionId: 3,
        text: 'Uncaught Error: boom',
        scriptId: '42',
        url: 'https://example.com/app.js',
        lineNumber: 7,
        columnNumber: 2,
        exception: {
          type: 'object',
          subtype: 'error',
          description: 'Error: boom\n    at fn (https://example.com/app.js:8:4)',
        },
      },
    });

    assert.ok(entry);
    assert.equal(entry!.type, 'unhandled_exception');
    assert.equal(entry!.message, 'Uncaught Error: boom');
    assert.equal(entry!.filename, 'https://example.com/app.js');
    assert.equal(entry!.lineno, 7);
    assert.equal(entry!.colno, 2);
    assert.ok(entry!.stack.includes('fn'));
  });

  test('browser-observed exception does not fabricate values Chrome omitted', () => {
    const entry = normalizeExceptionThrown({
      exceptionDetails: { exceptionId: 1, text: 'boom' },
    });
    assert.ok(entry);
    assert.equal(entry!.type, 'unhandled_exception');
    assert.equal(entry!.message, 'boom');
    assert.equal(entry!.filename, undefined);
    assert.equal(entry!.lineno, undefined);
    assert.equal(entry!.colno, undefined);
    assert.equal(entry!.stack, '');
  });

  test('observer accumulates console and error entries for the active tab', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(8, transport);
    await observer.start();

    transport.emitEvent({ tabId: 8 }, 'Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1700000000,
      executionContextId: 1,
      args: [{ type: 'string', value: 'hello' }],
    });
    transport.emitEvent({ tabId: 8 }, 'Runtime.exceptionThrown', {
      timestamp: 1700000001,
      executionContextId: 1,
      exceptionDetails: { exceptionId: 1, text: 'boom' },
    });

    assert.equal(observer.getConsoleEntries().length, 1);
    assert.equal(observer.getConsoleEntries()[0].message, 'hello');
    assert.equal(observer.getJsErrorEntries().length, 1);
    assert.equal(observer.getJsErrorEntries()[0].message, 'boom');

    // Both are also retained as browser-observed observations with provenance.
    const drained = observer.poll();
    assert.equal(drained.length, 2);
    for (const observation of drained) {
      assert.equal(observation.acquisition, 'chrome-debugger');
      assert.equal(observation.provenance.tabId, 8);
    }
  });

  test('events from a different tab are rejected', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(8, transport);
    await observer.start();

    transport.emitEvent({ tabId: 999 }, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ type: 'string', value: 'forged' }],
    });
    transport.emitEvent({ tabId: 999 }, 'Runtime.exceptionThrown', {
      exceptionDetails: { exceptionId: 1, text: 'forged' },
    });

    assert.equal(observer.getConsoleEntries().length, 0);
    assert.equal(observer.getJsErrorEntries().length, 0);
    assert.equal(observer.poll().length, 0);
  });

  test('console history is bounded at 200 and errors at 50', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(8, transport);
    await observer.start();

    for (let i = 0; i < 210; i += 1) {
      transport.emitEvent({ tabId: 8 }, 'Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'number', value: i }],
      });
    }
    for (let i = 0; i < 60; i += 1) {
      transport.emitEvent({ tabId: 8 }, 'Runtime.exceptionThrown', {
        exceptionDetails: { exceptionId: i, text: `err ${i}` },
      });
    }

    assert.equal(observer.getConsoleEntries().length, 200);
    assert.equal(observer.getJsErrorEntries().length, 50);
  });

  test('Chrome detach clears accumulated browser-observed entries', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(8, transport);
    await observer.start();

    transport.emitEvent({ tabId: 8 }, 'Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'hello' }],
    });
    assert.equal(observer.getConsoleEntries().length, 1);

    transport.emitDetach({ tabId: 8 }, 'target_closed');
    assert.equal(observer.getConsoleEntries().length, 0);
    assert.equal(observer.getJsErrorEntries().length, 0);
    assert.equal(observer.poll().length, 0);
  });
});

describe('DEVPEEPER browser-observed network (DEVPEEPER-004)', () => {
  interface MockTransport extends DebuggerTransport {
    attachCalls: Array<{ target: DebuggerTarget; version: string }>;
    detachCalls: Array<DebuggerTarget>;
    commands: Array<{ method: string; params?: unknown }>;
    responseBodies: Record<string, { body: string; base64Encoded?: boolean }>;
    getResponseBodyErrors: string[];
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
      responseBodies: {},
      getResponseBodyErrors: [],
      attach: async (target, version) => {
        transport.attachCalls.push({ target, version });
      },
      detach: async (target) => {
        transport.detachCalls.push(target);
      },
      sendCommand: async (_target, method, params) => {
        transport.commands.push({ method, params });
        if (method === 'Network.getResponseBody') {
          const requestId = (params as { requestId?: string }).requestId ?? '';
          if (transport.getResponseBodyErrors.includes(requestId)) {
            throw new Error('body unavailable');
          }
          return transport.responseBodies[requestId] ?? {};
        }
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

  test('normalizes an HTTP >=400 response into a NetworkEntry with bounded body preview', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    const rid = 'req-1';
    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: rid,
      timestamp: 100.0,
      loaderId: 'loader-1',
      frameId: 7,
      request: {
        url: 'https://api.example.com/missing',
        method: 'GET',
        headers: { 'X-Auth': 'token' },
      },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: rid,
      timestamp: 105.0,
      response: { status: 404 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
      requestId: rid,
      timestamp: 110.0,
    });

    transport.responseBodies[rid] = { body: '{"error": "Not Found"}', base64Encoded: false };

    const entries = await observer.getNetworkEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].url, 'https://api.example.com/missing');
    assert.equal(entries[0].method, 'GET');
    assert.equal(entries[0].status, 404);
    assert.equal(entries[0].duration, 10000);
    assert.equal(entries[0].responsePreview, '{"error": "Not Found"}');
    assert.deepEqual(entries[0].requestHeaders, { 'X-Auth': 'token' });

    const bodyCmd = transport.commands.find((c) => c.method === 'Network.getResponseBody');
    assert.ok(bodyCmd);
    assert.deepEqual((bodyCmd.params as Record<string, unknown>).requestId, rid);
  });

  test('network observations and getNetworkEntries carry Chromium provenance', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: 'req-9',
      timestamp: 1.0,
      loaderId: 'loader-abc',
      frameId: 4,
      request: { url: 'https://api.example.com/x', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: 'req-9',
      response: { status: 500 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
      requestId: 'req-9',
      timestamp: 2.0,
    });

    const observations = observer.drain();
    assert.equal(observations.length, 3);
    for (const observation of observations) {
      assert.equal(observation.acquisition, 'chrome-debugger');
      assert.equal(observation.provenance.tabId, 3);
    }
    assert.equal(observations[0].provenance.requestId, 'req-9');
    assert.equal(observations[0].provenance.loaderId, 'loader-abc');
    assert.equal(observations[0].provenance.frameId, 4);
    assert.equal(typeof observations[0].provenance.timestamp, 'number');
  });

  test('a browser-reported failure normalizes to status 0 with errorText preview', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: 'req-fail',
      timestamp: 10.0,
      request: { url: 'https://api.example.com/down', method: 'POST' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFailed', {
      requestId: 'req-fail',
      timestamp: 15.0,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });

    const entries = await observer.getNetworkEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 0);
    assert.equal(entries[0].responsePreview, 'net::ERR_CONNECTION_REFUSED');
    assert.equal(entries[0].duration, 5000);

    // A failed request has no body to fetch.
    assert.equal(transport.commands.some((c) => c.method === 'Network.getResponseBody'), false);
  });

  test('successful requests are not retained as network evidence', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: 'req-200',
      timestamp: 0.0,
      request: { url: 'https://api.example.com/ok', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: 'req-200',
      response: { status: 200 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
      requestId: 'req-200',
      timestamp: 1.0,
    });

    assert.equal((await observer.getNetworkEntries()).length, 0);
  });

  test('wrong-tab network events do not feed the tracker', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 999 }, 'Network.requestWillBeSent', {
      requestId: 'forged',
      timestamp: 0.0,
      request: { url: 'https://evil.example.com', method: 'GET' },
    });
    transport.emitEvent({ tabId: 999 }, 'Network.responseReceived', {
      requestId: 'forged',
      response: { status: 500 },
    });
    transport.emitEvent({ tabId: 999 }, 'Network.loadingFinished', {
      requestId: 'forged',
      timestamp: 1.0,
    });

    assert.equal((await observer.getNetworkEntries()).length, 0);
    assert.equal(observer.poll().length, 0);
  });

  test('network history is bounded at NETWORK_MAX_ENTRIES, dropping the oldest', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    for (let i = 0; i < 120; i += 1) {
      const rid = `req-${i}`;
      transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
        requestId: rid,
        timestamp: i,
        request: { url: `https://api.example.com/${i}`, method: 'GET' },
      });
      transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
        requestId: rid,
        response: { status: 404 },
      });
      transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
        requestId: rid,
        timestamp: i + 1,
      });
    }

    const entries = await observer.getNetworkEntries();
    assert.equal(entries.length, 100);
    assert.equal(entries[0].url, 'https://api.example.com/20');
    assert.equal(entries[entries.length - 1].url, 'https://api.example.com/119');
  });

  test('a getResponseBody failure keeps the entry with an empty preview', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    const rid = 'req-nobody';
    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: rid,
      timestamp: 0.0,
      request: { url: 'https://api.example.com/x', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: rid,
      response: { status: 500 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
      requestId: rid,
      timestamp: 1.0,
    });
    transport.getResponseBodyErrors.push(rid);

    const entries = await observer.getNetworkEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 500);
    assert.equal(entries[0].responsePreview, '');
  });

  test('base64 response bodies are decoded into the bounded preview', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    const rid = 'req-b64';
    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: rid,
      timestamp: 0.0,
      request: { url: 'https://api.example.com/x', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: rid,
      response: { status: 404 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', {
      requestId: rid,
      timestamp: 1.0,
    });
    transport.responseBodies[rid] = {
      body: Buffer.from('binary response content').toString('base64'),
      base64Encoded: true,
    };

    const entries = await observer.getNetworkEntries();
    assert.equal(entries[0].responsePreview, 'binary response content');
  });

  test('an in-flight HTTP failure is finalized by getNetworkEntries (SNITCH-time)', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: 'req-inflight',
      timestamp: 0.0,
      request: { url: 'https://api.example.com/late', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: 'req-inflight',
      response: { status: 503 },
    });
    // No loadingFinished/loadingFailed yet.

    const entries = await observer.getNetworkEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 503);
  });

  test('Chrome detach clears accumulated network history', async () => {
    const transport = makeTransport();
    const observer = new ChromiumObserver(3, transport);
    await observer.start();

    transport.emitEvent({ tabId: 3 }, 'Network.requestWillBeSent', {
      requestId: 'req-a',
      timestamp: 0.0,
      request: { url: 'https://api.example.com/resource', method: 'GET' },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.responseReceived', {
      requestId: 'req-a',
      response: { status: 500 },
    });
    transport.emitEvent({ tabId: 3 }, 'Network.loadingFinished', { requestId: 'req-a', timestamp: 2.0 });

    transport.emitDetach({ tabId: 3 }, 'target_closed');
    assert.equal((await observer.getNetworkEntries()).length, 0);
  });
});
