# DEVPEEPER

DEVPEEPER is DEVSnitcher's browser-specific sensing layer.

It is derived from PEEP's observation model, but it is not the PEEP runtime and does not inherit unrelated adapters or execution machinery.

DEVPEEPER owns only the browser observation behavior DEVSnitcher needs. DEVSnitcher remains responsible for evidence assembly, encrypted caching, redaction, screenshots, reporting, and the SNITCH user flow.

Current responsibility:

- start browser-side console, network, and JavaScript-error observation;
- collect environment and DOM context;
- return a DEVSnitcher `Evidence` snapshot to the page transport layer.

Future Chromium-native observation work should land behind this boundary rather than expanding DEVSnitcher into a general PEEP runtime.

The current page-context transport remains separate from this module. Moving observation behind DEVPEEPER does not by itself authenticate the existing `window.postMessage` evidence ingress.
