# DEVPEEPER

DEVPEEPER is DEVSnitcher's browser-specific sensing layer.

It is derived from PEEP's observation model, but it is not the PEEP runtime and does not inherit unrelated adapters or execution machinery.

DEVPEEPER owns only the browser observation behavior DEVSnitcher needs. DEVSnitcher remains responsible for evidence assembly, encrypted caching, redaction, screenshots, reporting, and the SNITCH user flow.

Current responsibility:

- execute a bounded Chrome-mediated probe for environment, focused DOM and current selection through `chrome.scripting.executeScript`;
- normalize Chrome's `InjectionResult` into a DEVPEEPER observation envelope (payload, acquisition mechanism, browser provenance);
- start browser-side console, network, and JavaScript-error observation (legacy path, pending Chromium-native migration);
- return a DEVSnitcher `Evidence` snapshot to the evidence assembly layer.

Future Chromium-native observation work should land behind this boundary rather than expanding DEVSnitcher into a general PEEP runtime.

Status by evidence source:

- **Environment / DOM / selection**: browser-mediated through `chrome.scripting.executeScript`. Chrome returns the result in an `InjectionResult`, so a hostile page cannot forge it via `window.postMessage`. Chrome authenticates the transport path; the page can still influence the underlying DOM/focus state it exposes.
- **Console / network / JS errors**: legacy page-context collection, still carried over the `window.postMessage` page bridge. This ingress is not browser-authenticated and is separate, unresolved security work.

Moving more observation behind DEVPEEPER does not by itself authenticate the legacy `window.postMessage` evidence ingress.
