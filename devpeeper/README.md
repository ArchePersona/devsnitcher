# DEVPEEPER

DEVPEEPER is DEVSnitcher's browser-specific sensing layer.

It is derived from PEEP's observation model, but it is not the PEEP runtime and does not inherit unrelated adapters or execution machinery.

DEVPEEPER owns only the browser observation behavior DEVSnitcher needs. DEVSnitcher remains responsible for evidence assembly, encrypted caching, redaction, screenshots, reporting, and the SNITCH user flow.

Current responsibility:

- execute a bounded Chrome-mediated probe for environment, focused DOM and current selection through `chrome.scripting.executeScript`;
- normalize Chrome's `InjectionResult` into a DEVPEEPER observation envelope (payload, acquisition mechanism, browser provenance);
- attach a Chromium/CDP observer to the active tab through `chrome.debugger` and normalize browser-issued events into DEVPEEPER observations with preserved provenance;
- observe browser-issued console (`Runtime.consoleAPICalled`), runtime-error (`Runtime.exceptionThrown`) and network (`Network.*`) events and normalize them into DEVSnitch console/JS-error/network evidence with preserved provenance;
- follow the active tab while the extension operates so browser-observed events are not missed before SNITCH is pressed;
- return a DEVSnitcher `Evidence` snapshot to the evidence assembly layer.

Future Chromium-native observation work should land behind this boundary rather than expanding DEVSnitcher into a general PEEP runtime.

## Acquisition mechanisms

DEVPEEPER keeps acquisition mechanisms distinct by assurance level:

1. **Browser-observed** — `chrome-debugger`: Chromium/CDP instrumentation → extension/DEVPEEPER. Covers console, runtime errors and network.
2. **Browser-returned** — `chrome-scripting`: `chrome.scripting.executeScript` → Chrome `InjectionResult`. Covers environment/DOM/selection.

There is no page-reported mechanism. The legacy `window.postMessage` evidence bus and MAIN-world evidence collector have been removed; DEVSnitcher no longer injects a page-world collector and `page-script.js` is no longer built or exposed.

Correlating a page-reported value with a tab ID, URL, timestamp, document ID, script hash, or page message does **not** make it browser-observed. Browser-native provenance belongs only to data actually obtained through Chrome-controlled instrumentation or Chrome-controlled result transport.

## Chromium observation foundation

The Chromium observer:

- attaches to the browser-selected active tab only (no whole-browser or multi-target monitoring);
- enables only the minimal `Page`, `Runtime` and `Network` domains needed for browser-observed console/runtime-error/network observation;
- preserves browser-issued provenance (`tabId`, `frameId`, `loaderId`, `executionContextId`, `scriptId`, `timestamp`, `requestId`, etc.) without inventing replacements;
- treats Chromium identifiers as provenance, not durable source identity. There is no `SourceIdentity` object and no per-navigation source rollover;
- exercises passive observation (start/stop/isRunning/poll) — no command submission, no PEEP execution-adapter semantics;
- attaches/detaches through the `chrome.debugger` permission, required for browser-observed provenance;
- accumulates bounded console (200), runtime-error (50) and network (100) history for the current active-tab session; the accumulation is cleared when the attachment is replaced, stopped or invalidated so evidence from different tabs never mixes.

The active tab is followed continuously (`chrome.tabs.onActivated`) so observation begins when the tab becomes active rather than waiting for SNITCH. Only one active-tab observer exists at a time; switching tabs detaches the prior observer and attaches the new supported active tab. Browser-internal/unsupported pages are excluded.

## Evidence status

- **Browser-observed**: console; runtime exceptions/errors; network (HTTP failures only).
- **Browser-returned**: environment; focused DOM; selection.
- **Page-reported / legacy**: none.

At SNITCH time the background assembles the active-tab Chromium session's browser-observed console/runtime/network evidence into the trusted evidence path (→ encrypted cache → redaction → report). No authoritative evidence originates from a page-authored message. Chromium provenance describes observation, not the semantic truthfulness of what the page did.

Console and runtime-error normalization is bounded and deterministic: it reads only browser-supplied fields (`value`, `unserializableValue`, `description`, `subtype`/`type`) and never executes page JavaScript or calls `Runtime.getProperties` to reconstruct formatting. `Runtime.exceptionThrown` does not expose a reliable promise-rejection flag, so the observer emits the honest `unhandled_exception` classification and does not synthesize `promise_rejection`.

Network observation is browser-native and bounded. It reconstructs per-request state from Chromium's `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed` events and retains only problem requests: an HTTP status `>= 400`, or a request Chromium reports as failed before a normal HTTP response (status `0`). Successful traffic is never retained. Request identity is Chromium's `requestId` (never URL matching) and durations use one monotonic Chromium clock only (wall-clock and monotonic timestamps are never mixed). Response bodies are fetched via `Network.getResponseBody` only for retained HTTP failures, base64-decoded when indicated, and truncated to 1000 characters; a missing/failed body keeps the entry with an empty preview. All network evidence is bounded at 100 entries per active-tab session. The page no longer starts any fetch/XHR monkey-patching collector, so ordinary webpages are no longer modified.

Environment / DOM / selection are browser-mediated through `chrome.scripting.executeScript`. Chrome returns the result in an `InjectionResult`, so a hostile page cannot forge it via `window.postMessage`.
