import type { Evidence, SnitchMessage } from '../../shared/types';

const PAGE_SCRIPT_SRC = chrome.runtime.getURL('page-script.js');
const CACHE_REFRESH_INTERVAL_MS = 2000;
let cacheRefreshInFlight = false;

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

function collectEvidenceFromPage(): Promise<Evidence> {
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
      resolve(data.evidence);
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'COLLECT_EVIDENCE' }, '*');
  });
}
