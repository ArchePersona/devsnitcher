import { snapshotProbe } from '../../devpeeper/snapshot-probe';
import type { BoundedSnapshot } from '../../devpeeper/snapshot-probe';
import {
  makeBoundedObservation,
  type BoundedObservation,
  type InjectionResultLike,
} from '../../devpeeper/observation';
import type { Evidence, SnitchMessage } from '../../shared/types';

const PAGE_SCRIPT_SRC = chrome.runtime.getURL('page-script.js');
const CACHE_REFRESH_INTERVAL_MS = 2000;
let cacheRefreshInFlight = false;
let cachedTabId: number | undefined;

function injectPageScript(): void {
  try {
    if (document.documentElement.querySelector('script[data-devsnitcher-page-script]')) return;

    const script = document.createElement('script');
    script.src = PAGE_SCRIPT_SRC;
    script.dataset.devsnitcherPageScript = 'true';
    script.onload = () => script.remove();
    script.onerror = () => script.remove();
    document.documentElement.prepend(script);
  } catch {
    // Injection can fail under strict CSP; silently ignore so we don't break the page.
  }
}

injectPageScript();
window.setTimeout(queueCacheRefresh, 250);
window.setInterval(queueCacheRefresh, CACHE_REFRESH_INTERVAL_MS);

chrome.runtime.onMessage.addListener((msg: SnitchMessage, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return false;
  }

  if (msg?.type === 'REFRESH_CACHE') {
    refreshEncryptedCache()
      .then(() => sendResponse({ type: 'CACHE_REFRESHED' } satisfies SnitchMessage))
      .catch((error) =>
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: error instanceof Error ? error.message : String(error),
        } satisfies SnitchMessage),
      );
    return true;
  }

  return false;
});

function queueCacheRefresh(): void {
  if (cacheRefreshInFlight) return;
  cacheRefreshInFlight = true;
  void refreshEncryptedCache()
    .catch(() => undefined)
    .finally(() => {
      cacheRefreshInFlight = false;
    });
}

async function refreshEncryptedCache(): Promise<void> {
  const evidence = await collectEvidenceFromPage();
  const response = (await chrome.runtime.sendMessage({
    type: 'CACHE_EVIDENCE',
    evidence,
  } satisfies SnitchMessage)) as SnitchMessage | undefined;

  if (response?.type !== 'CACHE_STORED') {
    throw new Error('Background did not confirm evidence cache write');
  }
}

async function collectEvidenceFromPage(): Promise<Evidence> {
  // Environment and DOM come from the Chrome-mediated DEVPEEPER bounded probe,
  // NOT from page-authored messages.
  const bounded = await acquireBoundedObservation();

  // Console/network/JS-error collection still uses the legacy page path,
  // pending later DEVPEEPER milestones. Only those fields are trusted here.
  const legacy = await collectLegacyConsoleNetworkErrors();

  return {
    environment: bounded.payload.environment,
    console: legacy.console,
    network: legacy.network,
    jsErrors: legacy.jsErrors,
    dom: bounded.payload.dom,
    screenshot: null,
  };
}

async function getTabId(): Promise<number> {
  if (cachedTabId != null) return cachedTabId;
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_TAB_ID',
  } satisfies SnitchMessage)) as SnitchMessage | undefined;
  if (response?.type === 'TAB_ID' && typeof response.tabId === 'number') {
    cachedTabId = response.tabId;
    return response.tabId;
  }
  throw new Error('Could not resolve tab id for bounded observation');
}

async function acquireBoundedObservation(): Promise<BoundedObservation> {
  const tabId = await getTabId();

  const results = await chrome.scripting.executeScript<[], BoundedSnapshot>({
    target: { tabId },
    world: 'ISOLATED',
    func: snapshotProbe,
  });

  const result = results[0] as (InjectionResultLike & { result?: BoundedSnapshot }) | undefined;
  if (!result || !result.result) {
    throw new Error('DEVPEEPER bounded probe returned no result');
  }

  return makeBoundedObservation(result.result, result, tabId, Date.now());
}

function collectLegacyConsoleNetworkErrors(): Promise<
  Pick<Evidence, 'console' | 'network' | 'jsErrors'>
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Timeout waiting for page evidence'));
    }, 8000);

    const handler = (ev: MessageEvent) => {
      if (ev.source !== window) return;
      const data = ev.data as SnitchMessage | undefined;
      if (!data || data.type !== 'EVIDENCE_RESULT') return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);

      // Environment/DOM in this page-authored response are intentionally NOT used.
      // Chrome-mediated bounded observation is authoritative for those fields.
      const evidence = data.evidence;
      resolve({
        console: evidence.console,
        network: evidence.network,
        jsErrors: evidence.jsErrors,
      });
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'COLLECT_EVIDENCE' }, '*');
  });
}
