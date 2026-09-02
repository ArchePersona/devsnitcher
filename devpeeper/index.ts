import { startConsoleCollector, collectConsole } from '../collectors/console';
import { collectDom } from '../collectors/dom';
import { collectEnvironment } from '../collectors/environment';
import { startJavaScriptCollector, collectJavaScript } from '../collectors/javascript';
import { startNetworkCollector, collectNetwork } from '../collectors/network';
import type { Evidence } from '../shared/types';

let started = false;

/**
 * DEVPEEPER is DEVSnitcher's browser-specific sensing layer.
 *
 * It deliberately inherits only the observation behavior DEVSnitcher needs.
 * It does not depend on the PEEP runtime or any unrelated PEEP adapters.
 */
export function startDevPeeper(): void {
  if (started) return;
  started = true;

  startConsoleCollector();
  startNetworkCollector();
  startJavaScriptCollector();
}

export function collectDevPeeperEvidence(): Evidence {
  return {
    environment: collectEnvironment(),
    console: collectConsole(),
    network: collectNetwork(),
    jsErrors: collectJavaScript(),
    dom: collectDom(readSelection()),
    screenshot: null,
  };
}

function readSelection(): Element | null {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const node = selection.anchorNode;
    if (node && node.nodeType === 1) return node as Element;
    if (node?.parentElement) return node.parentElement;
  }

  return document.activeElement;
}
