import { collectDom } from '../collectors/dom';
import { collectEnvironment } from '../collectors/environment';
import type { Evidence } from '../shared/types';

let started = false;

/**
 * DEVPEEPER is DEVSnitcher's browser-specific sensing layer.
 *
 * It deliberately inherits only the observation behavior DEVSnitcher needs.
 * It does not depend on the PEEP runtime or any unrelated PEEP adapters.
 *
 * No legacy collectors are started here. Console, runtime-error and network
 * evidence are all browser-observed through the active-tab Chromium session in
 * the background, so the page is no longer authoritative for those fields and
 * ordinary webpages no longer have their fetch/XHR modified.
 */
export function startDevPeeper(): void {
  if (started) return;
  started = true;
}

export function collectDevPeeperEvidence(): Evidence {
  return {
    environment: collectEnvironment(),
    // Console, runtime-error and network evidence are browser-observed,
    // assembled from the active-tab Chromium observer at SNITCH time. They are
    // not produced by the page here.
    console: [],
    network: [],
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
