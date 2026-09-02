import { redactEvidence } from '../../redaction/index';
import { buildMarkdownReport } from '../../report/markdown';
import { captureScreenshot } from '../../collectors/screenshot';
import { EvidenceCache, base64ToBytes, bytesToBase64, isEvidenceShape } from './cache';
import { ActiveTabObserverController } from '../../devpeeper/active-observer';
import { chromeDebuggerTransport } from '../../devpeeper/debugger-transport';
import { snapshotProbe, type BoundedSnapshot } from '../../devpeeper/snapshot-probe';
import {
  makeBoundedObservation,
  type InjectionResultLike,
} from '../../devpeeper/observation';
import { pasteReport } from './snitchshot-paste';
import { SnitchshotBuffer } from './snitchshot-buffer';
import type {
  ConsoleEntry,
  Evidence,
  JsErrorEntry,
  NetworkEntry,
  SnitchMessage,
} from '../../shared/types';

const CACHE_KEY_STORAGE = 'devsnitcher:evidence-cache-key:v1';

// DEVPEEPER Chromium observation foundation. Owned here because chrome.debugger
// is only available to trusted extension contexts. The observer follows the
// active tab while the extension operates and accumulates bounded browser-
// observed console/runtime-error evidence for the current active-tab session.
// That accumulated evidence is the authoritative console/error source at
// SNITCH time; page-authored console/jsErrors are ignored.
//
// The controller serializes every start/stop transition so concurrent
// activation events cannot overlap in-flight attach/detach and leak multiple
// debugger sessions (see devpeeper/active-observer.ts).
const activeObserver = new ActiveTabObserverController(
  () => chromeDebuggerTransport(),
  isSupportedTabUrl,
);

chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => {
    // The default access level (trusted contexts only) already applies.
  });

const cache = new EvidenceCache(
  {
    get: async (key) => chrome.storage.session.get(key),
    set: async (items) => {
      await chrome.storage.session.set(items);
    },
    remove: async (key) => {
      await chrome.storage.session.remove(key);
    },
  },
  getOrCreateCacheKey,
);

// Private DEVSnitcher-owned SNITCHSHOT buffer. Global, session-scoped, restricted
// to trusted contexts, and authoritative over the owned paste lifecycle. It is
// cleared only by a successful PASTE SNITCHSHOT, never by tab switching.
const snitchshot = new SnitchshotBuffer({
  get: async (key) => chrome.storage.session.get(key),
  set: async (items) => {
    await chrome.storage.session.set(items);
  },
  remove: async (key) => {
    await chrome.storage.session.remove(key);
  },
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  // Follow the active tab while the extension operates so browser-observed
  // console/runtime events are not missed before SNITCH is pressed. Only one
  // active-tab observer exists at a time; a tab change detaches the prior one.
  void chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) => activeObserver.follow(tab).catch(() => undefined))
    .catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void cache.clear(tabId);
  void activeObserver.handleRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    void cache.clear(tabId);
  }
});

chrome.runtime.onMessage.addListener(
  (msg: SnitchMessage, sender, sendResponse) => {
    if (msg?.type === 'CACHE_EVIDENCE') {
      if (sender.id !== chrome.runtime.id || sender.tab?.id == null || !sender.tab.url) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Rejected evidence cache write from untrusted sender',
        } satisfies SnitchMessage);
        return false;
      }

      if (!isEvidenceShape(msg.evidence)) {
        // Reject malformed cache-write messages instead of coercing them into valid data.
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Rejected malformed evidence cache write',
        } satisfies SnitchMessage);
        return false;
      }

      cache
        .store(sender.tab.id, sender.tab.url, msg.evidence)
        .then(() => sendResponse({ type: 'CACHE_STORED' } satisfies SnitchMessage))
        .catch((err) =>
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: String(err),
          } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type === 'GET_TAB_ID') {
      // Content scripts resolve their host tab id through the background, which
      // sees the sender's tab context. Used to target the DEVPEEPER bounded probe.
      if (sender.tab?.id != null) {
        sendResponse({ type: 'TAB_ID', tabId: sender.tab.id } satisfies SnitchMessage);
      } else {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Rejected: no tab context for tab id resolution.',
        } satisfies SnitchMessage);
      }
      return false;
    }

    if (msg?.type === 'GET_BOUNDED_OBSERVATION') {
      // The DEVPEEPER bounded probe must run chrome.scripting.executeScript from
      // a trusted extension context: chrome.scripting is unavailable to content
      // scripts (it is undefined there). The content bridge therefore requests
      // the observation here, and this background handler targets its own tab.
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Rejected: no tab context for bounded observation.',
        } satisfies SnitchMessage);
        return false;
      }

      chrome.scripting
        .executeScript<[], BoundedSnapshot>({
          target: { tabId },
          world: 'ISOLATED',
          func: snapshotProbe,
        })
        .then((results) => {
          const result = results[0] as
            | (InjectionResultLike & { result?: BoundedSnapshot })
            | undefined;
          if (!result || !result.result) {
            throw new Error('DEVPEEPER bounded probe returned no result');
          }
          const observation = makeBoundedObservation(result.result, result, tabId, Date.now());
          sendResponse({
            type: 'BOUNDED_OBSERVATION',
            environment: observation.payload.environment,
            dom: observation.payload.dom,
          } satisfies SnitchMessage);
        })
        .catch((err) =>
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: String(err),
          } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type === 'SNITCHSHOT_STATUS') {
      // Popup reads the buffer occupancy so it can present SNITCH or PASTE.
      // Refuse tab-relayed senders so page/content scripts cannot probe the
      // private buffer state.
      if (sender.tab) {
        sendResponse({
          type: 'SNITCH_ERROR',
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }
      snitchshot
        .isOccupied()
        .then((occupied) =>
          sendResponse({ type: 'SNITCHSHOT_STATUS_RESULT', occupied } satisfies SnitchMessage),
        )
        .catch(() =>
          sendResponse({ type: 'SNITCHSHOT_STATUS_RESULT', occupied: false } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type === 'PASTE_SNITCHSHOT') {
      // DEVSnitcher-owned paste: only the extension popup may invoke it. The
      // buffer is read, the report is inserted into the active supported tab's
      // focused editable target, and the buffer is cleared only on a confirmed
      // successful insertion. A failed/hostile insertion cannot consume it.
      if (sender.tab) {
        sendResponse({
          type: 'PASTE_SNITCHSHOT_RESULT',
          pasted: false,
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }

      (async () => {
        try {
          const record = await snitchshot.peek();
          if (!record) {
            sendResponse({
              type: 'PASTE_SNITCHSHOT_RESULT',
              pasted: false,
              error: 'No SNITCHSHOT is pending.',
            } satisfies SnitchMessage);
            return;
          }

          const tab = await getActiveTab();
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: pasteReport,
            args: [record.report],
          });
          const outcome = results[0]?.result as
            | { ok: boolean; reason?: string }
            | undefined;

          if (!outcome?.ok) {
            // Retain the buffer so the user can retry.
            sendResponse({
              type: 'PASTE_SNITCHSHOT_RESULT',
              pasted: false,
              error: outcome?.reason ?? 'DEVSnitcher could not insert the report.',
            } satisfies SnitchMessage);
            return;
          }

          // Only a confirmed insertion consumes the SNITCHSHOT.
          await snitchshot.clear();
          sendResponse({
            type: 'PASTE_SNITCHSHOT_RESULT',
            pasted: true,
          } satisfies SnitchMessage);
        } catch (err) {
          // Retain the buffer on any failure so it is never lost.
          sendResponse({
            type: 'PASTE_SNITCHSHOT_RESULT',
            pasted: false,
            error: String(err),
          } satisfies SnitchMessage);
        }
      })();
      return true;
    }

    if (msg?.type !== 'SNITCH') return false;

    // Privileged action: only the extension popup may trigger SNITCH.
    // Messages relayed from a tab (content script) are refused.
    if (sender.tab) {
      sendResponse({
        type: 'SNITCH_ERROR',
        error: 'SNITCH can only be triggered from the DEVSnitcher popup.',
      } satisfies SnitchMessage);
      return false;
    }

    (async () => {
      try {
        // SNITCH gate: exactly one outstanding SNITCHSHOT is allowed globally.
        // If already OCCUPIED, refuse without overwriting or discarding it.
        if (await snitchshot.isOccupied()) {
          sendResponse({
            type: 'SNITCH_ERROR',
            error: 'SNITCHSHOT pending — paste it before taking another.',
          } satisfies SnitchMessage);
          return;
        }

        const tab = await getActiveTab();

        // Establish the DEVPEEPER active-tab Chromium observation lifecycle.
        // Await the serialized follow transition so browser-observed evidence is
        // read only after the observer has settled (not while a start is still in
        // flight). A startup failure must not block SNITCH itself, so it is
        // swallowed here; browser evidence will simply be empty for that session.
        try {
          await activeObserver.follow(tab);
        } catch {
          // Observation startup failed; continue SNITCH with empty browser evidence.
        }

        await ensureContentScript(tab.id!);
        const evidence = await getCachedEvidenceOrRefresh(tab.id!, tab.url!);

        // Console, runtime-error and network evidence are browser-observed from
        // the active-tab Chromium session only. The legacy page-reported
        // evidence bus has been removed; no page-authored value is trusted here.
        const observed = await currentBrowserObservedEvidence(tab.id!);
        evidence.console = observed.console;
        evidence.jsErrors = observed.jsErrors;
        evidence.network = observed.network;

        const screenshot = msg.screenshot
          ? await captureScreenshot(tab.windowId)
          : null;
        evidence.screenshot = screenshot;

        // Persist the assembled (browser-observed) evidence into the encrypted
        // cache so the cached record reflects the trusted evidence path.
        await cache.store(tab.id!, tab.url!, evidence);

        const redacted = redactEvidence(evidence);
        const report = buildMarkdownReport({
          evidence: redacted,
          userNotes: msg.userNotes ?? '',
        });

        // The completed, redacted report becomes the outstanding SNITCHSHOT.
        // Only after this succeeds does the buffer move EMPTY → OCCUPIED.
        await snitchshot.fill(report, tab.id!);

        sendResponse({
          type: 'SNITCH_RESULT',
          report,
          screenshotDataUrl: screenshot?.dataUrl,
        } satisfies SnitchMessage);
      } catch (err) {
        sendResponse({
          type: 'SNITCH_ERROR',
          error: String(err),
        } satisfies SnitchMessage);
      }
    })();

    return true;
  },
);

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const tab = tabs[0];

  if (!tab?.id) {
    throw new Error('No active tab found. Open a normal browser tab and try again.');
  }

  if (!tab.url) {
    throw new Error('Active tab has no URL.');
  }

  if (!isSupportedTabUrl(tab.url)) {
    throw new Error('DEVSnitcher cannot inspect browser-internal pages.');
  }

  return tab;
}

function isSupportedTabUrl(url: string): boolean {
  return (
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('edge://') &&
    !url.startsWith('about:')
  );
}

/**
 * Browser-observed console/runtime-error/network evidence from the active-tab
 * Chromium session. Empty when there is no live observer bound to `tabId`, so
 * evidence from a replaced or invalidated attachment is never reused.
 */
async function currentBrowserObservedEvidence(tabId: number): Promise<{
  console: ConsoleEntry[];
  jsErrors: JsErrorEntry[];
  network: NetworkEntry[];
}> {
  const observer = activeObserver.liveFor(tabId);
  if (observer) {
    return {
      console: observer.getConsoleEntries(),
      jsErrors: observer.getJsErrorEntries(),
      network: await observer.getNetworkEntries(),
    };
  }
  return { console: [], jsErrors: [], network: [] };
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      { type: 'PING' } satisfies SnitchMessage,
    )) as SnitchMessage | undefined;
    return response?.type === 'PONG';
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await pingContentScript(tabId)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    'DEVSnitcher could not attach to this tab. The page may enforce a CSP that blocks injection, or the tab was opened before the extension was installed. Refresh the page and try again.',
  );
}

async function getCachedEvidenceOrRefresh(
  tabId: number,
  url: string,
): Promise<Evidence> {
  try {
    return await cache.load(tabId, url);
  } catch {
    await refreshEvidenceCache(tabId);
    return cache.load(tabId, url);
  }
}

async function refreshEvidenceCache(tabId: number): Promise<void> {
  const response = (await chrome.tabs.sendMessage(
    tabId,
    { type: 'REFRESH_CACHE' } satisfies SnitchMessage,
  )) as SnitchMessage | undefined;

  if (!response) {
    throw new Error('No response from content script');
  }

  if (response.type === 'EVIDENCE_ERROR') {
    throw new Error(response.error);
  }

  if (response.type !== 'CACHE_REFRESHED') {
    throw new Error('Unexpected response from content script');
  }
}

async function getOrCreateCacheKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.session.get(CACHE_KEY_STORAGE);
  const encoded = stored[CACHE_KEY_STORAGE];

  if (typeof encoded === 'string' && encoded.length > 0) {
    return crypto.subtle.importKey(
      'raw',
      base64ToBytes(encoded),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({
    [CACHE_KEY_STORAGE]: bytesToBase64(new Uint8Array(raw)),
  });

  return key;
}
