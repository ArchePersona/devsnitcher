import { collectDom } from '../collectors/dom';
import { collectEnvironment } from '../collectors/environment';
import { startNetworkCollector, collectNetwork } from '../collectors/network';
import type { Evidence } from '../shared/types';

let started = false;

/**
 * DEVPEEPER is DEVSnitcher's browser-specific sensing layer.
 *
 * It deliberately inherits only the observation behavior DEVSnitcher needs.
 * It does not depend on the PEEP runtime or any unrelated PEEP adapters.
 *
 * Only the legacy network collector is started here. Console and runtime-error
 * evidence are now browser-observed through the active-tab Chromium session in
 * the background, so the page no longer starts console/JS-error punch-to-page
 * collectors and is not authoritative for those fields.
 */
export function startDevPeeper(): void {
  if (started) return;
  started = true;

  startNetworkCollector();
}

export function collectDevPeeperEvidence(): Evidence {
  return {
    environment: collectEnvironment(),
    // Console and runtime-error evidence are browser-observed, assembled from
    // the active-tab Chromium observer at SNITCH time. They are not produced by
    // the page here.
    console: [],
    network: collectNetwork(),
    jsErrors: [],
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
