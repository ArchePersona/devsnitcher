import { startConsoleCollector, collectConsole } from '../../collectors/console';
import { startNetworkCollector, collectNetwork } from '../../collectors/network';
import { startJavaScriptCollector, collectJavaScript } from '../../collectors/javascript';
import { collectEnvironment } from '../../collectors/environment';
import { collectDom } from '../../collectors/dom';
import type { Evidence, SnitchMessage } from '../../shared/types';

let started = false;

function ensureStarted(): void {
  if (started) return;
  started = true;
  startConsoleCollector();
  startNetworkCollector();
  startJavaScriptCollector();
}

ensureStarted();

window.addEventListener('message', (ev: MessageEvent) => {
  const source = ev.source;
  if (source !== window) return;
  const data = ev.data as SnitchMessage | undefined;
  if (!data || typeof data !== 'object' || !('type' in data)) return;
  if ((data as SnitchMessage).type !== 'COLLECT_EVIDENCE') return;

  const evidence: Evidence = {
    environment: collectEnvironment(),
    console: collectConsole(),
    network: collectNetwork(),
    jsErrors: collectJavaScript(),
    dom: collectDom(readSelection()),
    screenshot: null,
  };

  const reply: SnitchMessage = { type: 'EVIDENCE_RESULT', evidence };
  window.postMessage(reply, '*');
});

function readSelection(): Element | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const node = sel.anchorNode;
    if (node && node.nodeType === 1) return node as Element;
    if (node && node.parentElement) return node.parentElement;
  }
  return document.activeElement;
}
