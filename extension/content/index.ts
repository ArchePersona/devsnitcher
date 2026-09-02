import type { BoundedObservationPayload } from '../../devpeeper/observation';
import type { Evidence, SnitchMessage } from '../../shared/types';

const CACHE_REFRESH_INTERVAL_MS = 2000;
let cacheRefreshInFlight = false;

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
  // NOT from page-authored messages. chrome.scripting is unavailable to content
  // scripts, so the probe runs in the background service worker and the result
  // is returned here over the extension runtime.
  const bounded = await acquireBoundedObservation();

  // Console, runtime-error and network evidence are all browser-observed
  // through the active-tab Chromium session and assembled in the background at
  // SNITCH time. The page is not authoritative for any of them.
  return {
    environment: bounded.environment,
    console: [],
    network: [],
    jsErrors: [],
    dom: bounded.dom,
    screenshot: null,
  };
}

async function acquireBoundedObservation(): Promise<BoundedObservationPayload> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_BOUNDED_OBSERVATION',
  } satisfies SnitchMessage)) as SnitchMessage | undefined;

  if (response?.type === 'BOUNDED_OBSERVATION') {
    return {
      environment: response.environment,
      dom: response.dom,
    };
  }

  const error =
    response?.type === 'EVIDENCE_ERROR' ? response.error : 'Background did not return a bounded observation';
  throw new Error(error);
}
