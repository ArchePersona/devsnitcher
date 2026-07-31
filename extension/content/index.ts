import type { SnitchMessage } from '../../shared/types';

const PAGE_SCRIPT_SRC = chrome.runtime.getURL('page-script.js');

function injectPageScript(): void {
  try {
    const script = document.createElement('script');
    script.src = PAGE_SCRIPT_SRC;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.addEventListener('load', () => script.remove());
    script.addEventListener('error', () => script.remove());
  } catch {
    // Injection can fail under strict CSP; silently ignore so we don't break the page.
  }
}

injectPageScript();

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as SnitchMessage | undefined;
  if (!data || !('type' in data)) return;
  if (data.type !== 'EVIDENCE_RESULT') return;
  chrome.runtime.sendMessage(data).catch(() => {
    // service worker may be asleep; ignore
  });
});

chrome.runtime.onMessage.addListener((msg: SnitchMessage, _sender, sendResponse) => {
  if (msg?.type === 'COLLECT_EVIDENCE') {
    window.postMessage({ type: 'COLLECT_EVIDENCE' } satisfies SnitchMessage, '*');
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
