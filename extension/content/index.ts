import type { Evidence, SnitchMessage } from '../../shared/types';

const PAGE_SCRIPT_SRC = chrome.runtime.getURL('page-script.js');

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

chrome.runtime.onMessage.addListener((msg: SnitchMessage, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return false;
  }

  if (msg?.type === 'COLLECT_EVIDENCE') {
    collectEvidenceFromPage()
      .then((evidence) => sendResponse({ type: 'EVIDENCE_RESULT', evidence }))
      .catch((error) =>
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});

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
