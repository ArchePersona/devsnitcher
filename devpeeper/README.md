# DEVPEEPER

DEVPEEPER is DEVSnitcher's browser-specific sensing layer.

It is derived from PEEP's observation model, but it is not the PEEP runtime and does not inherit unrelated adapters or execution machinery.

DEVPEEPER owns only the browser observation behavior DEVSnitcher needs. DEVSnitcher remains responsible for evidence assembly, encrypted caching, redaction, screenshots, reporting, and the SNITCH user flow.

Current responsibility:

- execute a bounded Chrome-mediated probe for environment, focused DOM and current selection through `chrome.scripting.executeScript`;
- normalize Chrome's `InjectionResult` into a DEVPEEPER observation envelope (payload, acquisition mechanism, browser provenance);
- attach a Chromium/CDP observer to the active tab through `chrome.debugger` and normalize browser-issued events into DEVPEEPER observations with preserved provenance;
- start browser-side console, network, and JavaScript-error observation (legacy path, pending Chromium-native migration);
- return a DEVSnitcher `Evidence` snapshot to the evidence assembly layer.

Future Chromium-native observation work should land behind this boundary rather than expanding DEVSnitcher into a general PEEP runtime.

## Acquisition mechanisms

DEVPEEPER keeps acquisition mechanisms distinct by assurance level:

1. **Browser-observed** — `chrome-debugger`: Chromium/CDP instrumentation → extension/DEVPEEPER. Established foundation milestone.
2. **Browser-returned** — `chrome-scripting`: `chrome.scripting.executeScript` → Chrome `InjectionResult`.
3. **Page-reported** — MAIN-world hook → page-mediated transport (legacy console/network/error ingress).

Correlating a page-reported value with a tab ID, URL, timestamp, document ID, script hash, or page message does **not** make it browser-observed. Browser-native provenance belongs only to data actually obtained through Chrome-controlled instrumentation or Chrome-controlled result transport.

## Chromium observation foundation

The Chromium observer:

- attaches to the browser-selected active tab only (no whole-browser or multi-target monitoring);
- enables only the minimal `Page` domain needed to establish the observation transport;
- preserves browser-issued provenance (`tabId`, `frameId`, `loaderId`, `timestamp`, etc.) without inventing replacements;
- treats Chromium identifiers as provenance, not durable source identity. There is no `SourceIdentity` object and no per-navigation source rollover;
- exercises passive observation (start/stop/isRunning/poll) — no command submission, no PEEP execution-adapter semantics;
- attaches/detaches through the `chrome.debugger` permission, required for browser-observed provenance.

Environment / DOM / selection, console, network, and JS-error evidence:
*Environment / DOM / selection* are browser-mediated through `chrome.scripting.executeScript`. Chrome returns the result in an `InjectionResult`, so a hostile page cannot forge it via `window.postMessage`.
*Console / network / JS errors* are legacy page-context collection, still carried over the `window.postMessage` page bridge. This ingress is not browser-authenticated and is separate, unresolved security work.

Moving more observation behind DEVPEEPER does not by itself authenticate the legacy `window.postMessage` evidence ingress.
