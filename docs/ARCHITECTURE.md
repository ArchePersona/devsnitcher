# DEVSnitcher Architecture

DEVSnitcher is built as a small browser extension with a strict local-first evidence flow.

The core path is:

```text
DEVPEEPER (bounded probe + Chromium observer) → Content Bridge → Background → Encrypted Session Cache
User clicks SNITCH → Popup → Background → Decrypt Cache → Redaction → Report → Clipboard
```

The extension does not require a backend, account, dashboard, hosted service, or AI provider integration.

---

## Design goal

The architecture exists to support one product action:

```text
Press SNITCH. Paste into AI.
```

Everything else is secondary.

---

## Runtime flow

1. DEVPEEPER's bounded probe observes environment, focused DOM and current selection through `chrome.scripting.executeScript` from extension-controlled code; Chrome returns the result inside its `InjectionResult`, not via a page-authored message.
2. DEVPEEPER attaches a Chromium/CDP observer to the active tab through `chrome.debugger`, enabling the minimal `Page`, `Runtime` and `Network` domains. Browser-issued console (`Runtime.consoleAPICalled`), runtime-error (`Runtime.exceptionThrown`) and network (`Network.*`) events are normalized into DEVPEEPER observations with preserved provenance; the observer follows the active tab continuously. There is no legacy page bridge.
3. DEVPEEPER normalizes the Chrome-mediated bounded observation and the content bridge assembles the evidence snapshot.
4. The content bridge sends accepted evidence to the background service worker through the extension runtime.
5. Background validates the evidence payload, encrypts valid evidence with AES-256-GCM, and writes only ciphertext plus required metadata to `chrome.storage.session`.
6. User opens the popup, optionally enters a short description, and clicks **SNITCH**.
7. Popup sends `SNITCH` to the background service worker.
8. Background refuses tab-relayed `SNITCH` messages and resolves the active tab only for the popup-originated action.
9. Background ensures the content script is present.
10. Background prefers the existing encrypted cache; if no usable cache exists, it may request one immediate refresh.
11. Background decrypts the cache inside trusted extension context and validates the decrypted evidence shape.
12. Background assembles the active-tab Chromium session's browser-observed console/runtime/network evidence into the trusted evidence path, then persists the assembled evidence to the encrypted cache.
13. Background optionally captures the user-requested screenshot.
14. Background applies redaction and builds the report.
15. Popup writes the report to the clipboard.
16. User pastes the report into AI or another debugging channel.

---

## Trust boundaries

DEVSnitcher separates three security concerns.

### Privileged-action authorization

`SNITCH` is a privileged extension action and must only originate from the extension UI.

The background service worker enforces this boundary directly: messages carrying `SNITCH` with a tab sender are refused. Page JavaScript must not be able to initiate `SNITCH`, request screenshot capture, or receive `SNITCH_RESULT` through the page-facing bridge.

The content bridge must not act as a general forwarding path from page-controlled `window.postMessage` traffic into privileged extension APIs.

### Encrypted cache confidentiality and integrity

Accepted evidence is cached only after it reaches the trusted background service worker and passes evidence-shape validation.

Background encrypts cache records with AES-256-GCM before storage. The key remains in trusted extension session storage, cache storage is restricted to `TRUSTED_CONTEXTS`, and each write uses a fresh random IV. Authenticated additional data binds the ciphertext to its tab cache identity.

The page does not receive the cache key or decrypted cache contents. Malformed cache-write payloads are rejected, authenticated tampering causes decryption failure, and decrypted payloads are shape-validated before use.

### Page-evidence authenticity

DEVPEEPER has two distinct evidence sources, with different authenticity properties. There is no page-reported source.

**Browser-observed (Chromium/CDP instrumentation).** Chromium-issued events are received through `chrome.debugger` and associated with the active-tab attachment. This covers console, runtime-error and failed/problem-network evidence. Acquisition mechanism: `chrome-debugger`. These carry browser-issued provenance (`tabId`, `frameId`, `loaderId`, `executionContextId`, `scriptId`, `requestId`, `timestamp`, etc.) obtained only through Chrome-controlled instrumentation.

**Browser-returned (Chrome-mediated bounded observations).** Environment, focused DOM and current selection are acquired through `chrome.scripting.executeScript` from extension-controlled code. Chrome returns the result directly to the extension in an `InjectionResult`; the page does not send these values over `window.postMessage`. A hostile page calling `window.postMessage` cannot substitute these bounded observations. Acquisition mechanism: `chrome-scripting`.

For both browser-mediated paths, Chrome authenticates the execution/return/instrumentation transport path to the extension. It does **not** make the observed page state semantically truthful — the webpage can still influence the DOM, focus, selection, console output, network behavior and lifecycle it exposes. This is a transport-path authenticity property, not a claim that MAIN-world data is inherently trustworthy.

There is no page-reported evidence ingress. The legacy `window.postMessage` `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` bus has been removed; DEVSnitcher injects no MAIN-world evidence collector and no authoritative evidence originates from a page-authored message. A hostile page has no DEVSnitch evidence protocol it can participate in by emitting `window.postMessage`.


---

## Layers

### Popup

The popup is the user interface.

Responsibilities:

- Show the DEVSnitcher brand
- Provide one dominant **SNITCH** action
- Accept optional user notes
- Toggle optional screenshot capture
- Display success or error state
- Write final output to clipboard when appropriate

The popup should stay simple.

---

### Background service worker

The background service worker owns privileged coordination and the encrypted cache boundary.

Responsibilities:

- Enforce popup-only `SNITCH` authorization
- Resolve the active tab for the popup action
- Reject unsupported browser-internal pages
- Ping or inject the content script when needed
- Accept cache writes only through the expected extension runtime path
- Validate cache-write evidence payloads before encryption
- Generate/import the session cache key
- Encrypt accepted evidence with AES-256-GCM before storage
- Decrypt and validate valid tab-bound cache records for SNITCH
- Remove per-tab cache records when tabs close or navigate/load a new page
- Own the DEVPEEPER Chromium/CDP observer and attach it to the active tab (best-effort, isolated from SNITCH)
- Follow the active tab (`chrome.tabs.onActivated`), detaching the prior observer and attaching the new supported active tab
- Assemble the active-tab Chromium session's browser-observed console/runtime evidence into the trusted evidence path at SNITCH time (page-authored console/jsErrors ignored)
- Stop the Chromium observer when its tab closes
- Capture screenshot evidence when explicitly requested by SNITCH
- Apply redaction
- Build the report payload
- Return output to the popup

The background worker should not become a dashboard, analytics layer, or hosted monitor.

---

### DEVPEEPER

DEVPEEPER is DEVSnitcher's browser sensing layer.

It runs extension-controlled code that observes the browser and page through browser-mediated mechanisms. It does not run the PEEP runtime, generic execution host, PowerShell support, or build/cloud adapters.

Current DEVPEEPER paths:

- **Chrome-mediated bounded probe** — executes a small self-contained probe in the tab's isolated world through `chrome.scripting.executeScript`. Chrome returns the result in an `InjectionResult` carrying browser-issued provenance (`tabId`, `frameId`, `documentId`). The probe reads environment, focused DOM context and current selection, starts no listeners, and never uses `window.postMessage`. Acquisition mechanism: `chrome-scripting` (browser-returned).
- **Chromium observation of console + runtime errors + network** — attaches a Chromium/CDP observer to the currently active tab through `chrome.debugger`, enables the minimal `Page`, `Runtime` and `Network` domains, and normalizes browser-issued events — `Page.frameNavigated`, `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed` — into DEVPEEPER observations with preserved provenance. Console, runtime-error and network evidence are browser-observed. Acquisition mechanism: `chrome-debugger` (browser-observed). Active-tab scope is deliberate: it does not monitor whole-browser or attach to every target, frame, worker, or background process. Network normalization retains only HTTP failures (status `>= 400`) or browser-reported failures (status `0`), never full-traffic logging, bounded at 100 entries; response bodies are fetched via `Network.getResponseBody` only for retained HTTP failures and bounded to 1000 characters.

The observer follows the currently active supported tab continuously (`chrome.tabs.onActivated`), so browser-observed console/runtime/network events are not missed before SNITCH is pressed. Only one active-tab observer exists at a time; switching tabs detaches the prior observer and attaches the new supported active tab, and browser-internal/unsupported pages are excluded. The observer accumulates bounded console (200), runtime-error (50) and network (100) history for the current active-tab session, cleared when the attachment is replaced, stopped or invalidated.

The `debugger` permission is intentionally required for browser-observed provenance: DEVPEEPER uses Chromium instrumentation so observation authority comes from the browser boundary rather than page-authored JavaScript messages.

Chromium identifiers are provenance, not durable source identity. DEVPEEPER does not implement a `SourceIdentity` object and does not create per-navigation source rollover; the active-tab attachment is the effective observation source. Network evidence is now browser-observed alongside console and runtime errors.

---

### Content bridge

The content bridge runs in the isolated extension world.

Responsibilities:

- Respond to PING/PONG checks
- Resolve its host tab id through the background
- Execute the DEVPEEPER bounded probe through `chrome.scripting.executeScript` and normalize its result into the evidence snapshot
- Assemble environment/DOM from the Chrome-mediated probe; console/jsErrors/network are left to the background's browser-observed Chromium session
- Prevent overlapping rolling-cache refreshes
- Send accepted evidence to background with `CACHE_EVIDENCE`
- Receive explicit `REFRESH_CACHE` fallback requests from background

The content bridge does not hold the encryption/decryption key and must not accept page-originated `SNITCH` commands or forward page-controlled requests into privileged extension behavior.

---

### Encrypted evidence cache

The rolling cache is browser-session-scoped and extension-owned.

Current properties:

- `chrome.storage.session`
- access restricted to `TRUSTED_CONTEXTS`
- AES-256-GCM authenticated encryption
- fresh 12-byte random IV per encryption
- tab-bound authenticated additional data
- per-tab cache records
- evidence-shape validation before storage and after decryption
- malformed cache writes rejected
- stale URL mismatch rejected
- per-tab record removed when the tab closes
- per-tab record cleared when the tab navigates or begins loading a new page
- rolling refresh approximately every two seconds
- SNITCH prefers a valid existing cache and refreshes only as fallback

Only ciphertext and the metadata needed to validate/decrypt it are stored as the evidence record. Plaintext evidence is not intentionally persisted to extension storage.

The cache is not an evidence-provenance system. It protects evidence after acceptance by the extension.

---

### DEVPEEPER evidence acquisition

DEVPEEPER acquires evidence through two browser-mediated mechanisms (see the page-evidence authenticity section above). The legacy page-context collector modules no longer exist.

Current evidence coverage:

- Environment, DOM context, selection — Chrome-mediated bounded probe (`chrome-scripting`, browser-returned)
- Console, runtime errors, network — active-tab Chromium observer (`chrome-debugger`, browser-observed)
- Screenshot

Acquisition should answer one question:

> Will this help diagnose the browser problem?

If not, do not collect it.

---

### Redaction

Redaction modules are pure safety helpers.

Current redaction areas:

- Headers
- Cookies
- Tokens
- URLs

Redaction happens after cache decryption and before report output.

Redaction is best effort, not a guarantee.

---

### Report builders

Report builders convert evidence into useful output formats.

Current output targets:

- Markdown
- JSON
- Clipboard

Markdown is the primary product format because it can be pasted directly into AI chats and issue trackers.

---

## Message types

Typical extension messages include:

```text
SNITCH
PING
PONG
GET_TAB_ID
TAB_ID
EVIDENCE_ERROR
CACHE_EVIDENCE
CACHE_STORED
REFRESH_CACHE
CACHE_REFRESHED
```

`SNITCH` belongs only to the extension message path initiated by the popup and is rejected when relayed from a tab. Cache messages belong to the extension runtime path. `GET_TAB_ID`/`TAB_ID` are extension-internal orchestration between the content bridge and background. The legacy `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` page-evidence protocol has been removed.

---

## Permission posture

DEVSnitcher should request only the permissions needed to capture and protect evidence from ordinary web pages.

Current intended scope includes:

```json
"permissions": ["activeTab", "clipboardWrite", "debugger", "scripting", "tabs", "storage"],
"host_permissions": ["http://*/*", "https://*/*"]
```

The `debugger` permission exists intentionally for browser-observed provenance: DEVPEEPER uses Chromium/CDP instrumentation (`chrome.debugger`) so observation authority comes from the browser boundary rather than page-authored JavaScript messages. It attaches only to the active tab and enables only the minimal `Page`, `Runtime` and `Network` domains. No unrelated permission was added.

Browser-internal pages such as `chrome://`, `edge://`, and `chrome-extension://` should not be inspected.

---

## Non-goals

The architecture should not add:

- Accounts
- Hosted storage
- SaaS backend
- Built-in AI diagnosis
- Persistent evidence storage beyond the browser session
- Analytics by default
- Vendor-specific AI flows
- Large application frameworks

Those may be separate products later. They do not belong in the core v2.x extension.

---

## Stability rules

1. Do not allow page-controlled or tab-relayed messages to invoke privileged extension actions.
2. Validate evidence before accepting a cache write.
3. Encrypt accepted cached evidence before storage.
4. Keep cache keys and decrypted cache contents out of page context.
5. Keep cache records isolated by tab/page identity and clear them on tab close/navigation.
6. Do not describe encrypted caching as proof of page-evidence provenance.
7. Guard against double-injection and overlapping refreshes.
8. Keep report output deterministic.
9. Keep redaction pure and testable.
10. Keep acquisition modules small.
11. Keep the popup simple.

---

## Ecosystem Note

DEVSnitcher is intentionally standalone.

It may later export into SHERLOCK-style evidence workflows, but v2.x has no backend, no SHERLOCK dependency, and no external upload path.

DEVSnitcher captures browser debugging evidence locally.

SHERLOCK is designed for deeper evidence reconstruction across files, conversations, timelines, source artifacts, provenance, and investigation reports.

Shared principle:

```text
Evidence first. AI second.
```

Learn more:

```text
https://sherlock-xprize.web.app
```

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, encrypted browser-session cache, user-triggered SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
