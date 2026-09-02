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

  // Console, runtime-error and network evidence are all browser-observed
  // through the active-tab Chromium session and assembled in the background at
  // SNITCH time. The page is not authoritative for any of them.
  return {
    environment: bounded.payload.environment,
    console: [],
    network: [],
    jsErrors: [],
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
