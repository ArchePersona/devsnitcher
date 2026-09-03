# DEVSnitcher Architecture

DEVSnitcher is built as a small browser extension with a strict local-first evidence flow.

The core path is:

```text
DEVPEEPER (bounded probe + Chromium session observer) → Background → report → Private Buffer
User clicks SNITCH → Background attaches session observer → Redaction → Report → Private Buffer → COPY SNITCHSHOT → System clipboard
```

The extension does not require a backend, account, dashboard, hosted service, or AI provider integration.

---

## Design goal

The architecture exists to support one product action:

```text
Press SNITCH. Copy into AI.
```

Everything else is secondary.

---

## Runtime flow

DEVPEEPER does nothing until an explicit **SNITCH** press. There is NO auto-attach: extension start, tab activation, navigation and popup-open never attach the debugger. The session state machine is `IDLE → SNITCH → OBSERVING → evidence complete → SNITCHSHOT_PENDING → clipboard release → IDLE`, and `OBSERVING → CANCEL → IDLE`.

1. User opens the popup, optionally enters a short description, and clicks **SNITCH** on the tab they want observed.
2. Popup sends `SNITCH` to the background service worker.
3. Background refuses tab-relayed `SNITCH` messages, then checks two gates: no other live session is already observing, and no SNITCHSHOT is already pending. If a session is already live, SNITCH is refused; if a SNITCHSHOT is pending, SNITCH is refused until it is copied out.
4. Background records the selected tab as the one and only session tab (immutable) and attaches a single Chromium/CDP observer to it through `chrome.debugger`, enabling the minimal `Page`, `Runtime` and `Network` domains.
5. DEVPEEPER's bounded probe captures environment, focused DOM and current selection on that session tab through `chrome.scripting.executeScript`, returned in Chrome's `InjectionResult` (bounded context completes immediately once acquired).
6. Browser-issued console (`Runtime.consoleAPICalled`), runtime-error (`Runtime.exceptionThrown`) and network (`Network.*`) events are normalized into observations while the live session runs. A surface completes when it has entries **OR** a bounded harvest window (`HARVEST_WINDOW_MS`) elapses — an empty surface is legitimate and complete, so the session never waits forever for an error.
7. When the bound evidence is complete, background finalizes: stops the observer (detaches the debugger), applies redaction, and builds the report.
8. Background stores the completed report as the outstanding SNITCHSHOT in the private buffer (occupied). A second SNITCH while occupied is refused from every tab.
9. Popup shows the pending state; the user presses **COPY SNITCHSHOT**. The popup reads the report and writes it to the system clipboard via the OS clipboard API.
10. Only after a confirmed successful clipboard write does background clear the private buffer, making SNITCH available again. A failed write retains the buffer.
11. At any point during OBSERVING, **CANCEL** terminates the session: it detaches the debugger, discards the partial report, clears the buffer to empty, and the session never resurrects.

---

## Trust boundaries

DEVSnitcher separates three security concerns.

### Privileged-action authorization

`SNITCH` is a privileged extension action and must only originate from the extension UI.

The background service worker enforces this boundary directly: messages carrying `SNITCH` with a tab sender are refused. Page JavaScript must not be able to initiate `SNITCH`, request screenshot capture, or receive `SNITCH_RESULT` through the page-facing bridge.

There is no content bridge or page-facing forwarding path, so page-controlled `window.postMessage` traffic cannot reach privileged extension APIs.

### Protecting the private SNITCHSHOT buffer

The finalized report is held in background-owned memory as the outstanding SNITCHSHOT (occupied) until an explicit **COPY SNITCHSHOT** writes it to the system clipboard and that write is confirmed (`CLIPBOARD_RELEASED`/`CLIPBOARD_CLEARED`). A second SNITCH is refused while the buffer is occupied, and a failed clipboard write retains the buffer. The report is not written to `chrome.storage` and is not a rolling, continuously-refreshed cache — it only exists after the completion of a live session that was explicitly started by pressing **SNITCH**.

### Page-evidence authenticity

DEVPEEPER has two distinct evidence sources, with different authenticity properties. There is no page-reported source.

**Browser-observed (Chromium/CDP instrumentation).** Chromium-issued events are received through `chrome.debugger` and associated with a SNITCH session attachment. This covers console, runtime-error and failed/problem-network evidence. Acquisition mechanism: `chrome-debugger`. These carry browser-issued provenance (`tabId`, `frameId`, `loaderId`, `executionContextId`, `scriptId`, `requestId`, `timestamp`, etc.) obtained only through Chrome-controlled instrumentation. No observer exists before SNITCH — the debugger is attached only to the selected tab and only for the live session.

**Browser-returned (Chrome-mediated bounded observations).** Environment, focused DOM and current selection are acquired through `chrome.scripting.executeScript` from extension-controlled code. Chrome returns the result directly to the extension in an `InjectionResult`; the page does not send these values over `window.postMessage`. A hostile page calling `window.postMessage` cannot substitute these bounded observations. Acquisition mechanism: `chrome-scripting`.

For both browser-mediated paths, Chrome authenticates the execution/return/instrumentation transport path to the extension. It does **not** make the observed page state semantically truthful — the webpage can still influence the DOM, focus, selection, console output, network behavior and lifecycle it exposes. This is a transport-path authenticity property, not a claim that MAIN-world data is inherently trustworthy.

There is no page-reported evidence ingress. The legacy `window.postMessage` `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` bus has been removed; DEVSnitcher injects no MAIN-world evidence collector and no authoritative evidence originates from a page-authored message. A hostile page has no DEVSnitch evidence protocol it can participate in by emitting `window.postMessage`.


---

## Layers

### Popup

The popup is the user interface.

Responsibilities:

- Show the DEVSnitcher brand
- Render the three primary CTAs — **SNITCH**, **CANCEL**, **COPY SNITCHSHOT** — at all times
- Accept optional user notes
- Toggle optional screenshot capture
- Display success or error state
- Poll `GET_STATUS` while observing to reflect session state
- Write the pending report to the system clipboard synchronously and confirm, then notify background

All three primary CTAs stay rendered. One deterministic render projection (`ctaConfig`) maps the background-authoritative state (`IDLE` / `OBSERVING` / `SNITCHSHOT_PENDING`) plus a popup-local `COPYING` transition onto `disabled`, a contextual label, and input availability, so the popup never presents contradictory active actions at the same time:

- `IDLE` → only **SNITCH** enabled
- `OBSERVING` → only **CANCEL** enabled
- `SNITCHSHOT_PENDING` → only **COPY SNITCHSHOT** enabled
- `COPYING` (local) → nothing enabled; **COPY** shows progress

The popup should stay simple.

---

### Background service worker

The background service worker owns privileged coordination of the authoritative SNITCH lifecycle.

Responsibilities:

- Enforce popup-only `SNITCH` authorization
- Resolve the selected tab for the popup action and reject unsupported browser-internal pages
- Manage the one live SNITCH session (immutable tab, never follows tab activation)
- Attach a single Chromium/CDP observer to the session tab and stop it (detach) on completion or cancel
- Enforce the global gates: one live session at a time, and SNITCH refused while a SNITCHSHOT is pending
- Run the bounded probe on the session tab to acquire environment/DOM/selection
- capture screenshot when explicitly requested by SNITCH
- Apply redaction
- Build the report payload
- Own the private SNITCHSHOT buffer, clearing it only after a confirmed clipboard write
- Respond to `GET_STATUS`, `CANCEL_SNITCH`, `GET_SNITCHSHOT` and `CLIPBOARD_RELEASED`

The background worker should not become a dashboard, analytics layer, or hosted monitor.

---

### DEVPEEPER

DEVPEEPER is DEVSnitcher's browser sensing layer.

It runs extension-controlled code that observes the browser and page through browser-mediated mechanisms. It does not run the PEEP runtime, generic execution host, PowerShell support, or build/cloud adapters.

Current DEVPEEPER paths:

- **Chrome-mediated bounded probe** — executes a small self-contained probe in the tab's isolated world through `chrome.scripting.executeScript`. Chrome returns the result in an `InjectionResult` carrying browser-issued provenance (`tabId`, `frameId`, `documentId`). The probe reads environment, focused DOM context and current selection, starts no listeners, and never uses `window.postMessage`. Acquisition mechanism: `chrome-scripting` (browser-returned).
- **Chromium observation of console + runtime errors + network** — attaches a Chromium/CDP observer to the tab selected by SNITCH through `chrome.debugger`, enabling the minimal `Page`, `Runtime` and `Network` domains, and normalizes browser-issued events — `Page.frameNavigated`, `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed` — into DEVPEEPER observations with preserved provenance. Console, runtime-error and network evidence are browser-observed. Acquisition mechanism: `chrome-debugger` (browser-observed). Session-tab scope is deliberate: it attaches to exactly one tab, never monitors whole-browser, and never attaches to every target, frame, worker, or background process. Network normalization retains only HTTP failures (status `>= 400`) or browser-reported failures (status `0`), never full-traffic logging, bounded at 100 entries; response bodies are fetched via `Network.getResponseBody` only for retained HTTP failures and bounded to 1000 characters.

Only one DEVPEEPER observer exists at a time, and only during a live SNITCH session. Nothing attaches before SNITCH: extension start, `chrome.tabs.onActivated`, navigation and popup-open never trigger a debugger attachment. The observer is permanently bound to the tab that was selected at SNITCH time — switching tabs never moves, restarts or resurrects the session. The observer accumulates bounded console (200), runtime-error (50) and network (100) history for the live session, cleared when the session is finalized or canceled. A session completes when its surfaces are complete: bounded context once acquired, and each of console/jsErrors/network when they have entries **OR** `HARVEST_WINDOW_MS` elapses (empty is legitimate and complete) — so a session that never produces an error still ends and detaches. `CANCEL` is terminal: it detaches and discards the partial report, and no later tab event can resurrect the session.

The `debugger` permission is intentionally required for browser-observed provenance: DEVPEEPER uses Chromium instrumentation so observation authority comes from the browser boundary rather than page-authored JavaScript messages.

Chromium identifiers are provenance, not durable source identity. DEVPEEPER does not implement a `SourceIdentity` object and does not create per-navigation source rollover; the SNITCH session attachment is the effective observation source. Network evidence is now browser-observed alongside console and runtime errors.

---

### SNITCHSHOT private buffer and clipboard release

There is exactly one outstanding SNITCHSHOT globally across DEVSnitcher.

The completed, redacted Markdown report is stored in a DEVSnitcher-owned private buffer in trusted, session-scoped extension storage (`chrome.storage.session`, restricted to `TRUSTED_CONTEXTS`). The buffer holds the report plus minimal lifecycle metadata (`sourceTabId`, `createdAt`). It is the authoritative store for the release lifecycle — the system clipboard is not a state store and does not gate SNITCH. The active session gate is **separate** from the outstanding-SNITCHSHOT buffer gate.

```text
EMPTY
  │  SNITCH succeeds
  ▼
OCCUPIED
  │  COPY SNITCHSHOT succeeds
  ▼
EMPTY
```

- **SNITCH gate.** Before creating a SNITCHSHOT, background checks the buffer. If occupied, SNITCH is refused from every tab with a clear message; the existing report is neither overwritten nor discarded. The buffer is global, not per-tab: another tab's SNITCH is blocked until the pending SNITCHSHOT is consumed.
- **System clipboard release.** The popup's primary action becomes **COPY SNITCHSHOT**. The popup requests the pending report (non-tab sender only), writes it to the system OS clipboard (`navigator.clipboard`, which is unreliable from an MV3 service worker), then sends `CLIPBOARD_RELEASED`. Background reads the report for a non-tab sender and passes it back with `SNITCHSHOT_CONTENT`. The page never messages the extension to trigger a copy; tab-relayed `GET_SNITCHSHOT`/`CLIPBOARD_RELEASED` are refused.
- **Consumption boundary.** The buffer is cleared only after the popup confirms a successful OS clipboard write. A failed write retains the buffer so the user can press COPY again. A report cleared only on confirmed delivery means "a SNITCHSHOT was copied to the clipboard" cannot be mistaken for a silent discard.

SNITCH and clipboard release are separate concerns: SNITCH governs a live observing session, while the buffer gates a pending report. Tab switching never clears or replaces an outstanding SNITCHSHOT.

---

### DEVPEEPER evidence acquisition

DEVPEEPER acquires evidence through two browser-mediated mechanisms (see the page-evidence authenticity section above). The legacy page-context collector modules no longer exist.

Current evidence coverage:

- Environment, DOM context, selection — Chrome-mediated bounded probe (`chrome-scripting`, browser-returned)
- Console, runtime errors, network — SNITCH-session Chromium observer (`chrome-debugger`, browser-observed)
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

Redaction happens on the completed report in the trusted background, before the report is placed in the private SNITCHSHOT buffer.

Redaction is best effort, not a guarantee.

---

### Report builders

Report builders convert evidence into useful output formats.

Current output targets:

- Markdown
- JSON

Markdown is the primary product format because it can be pasted directly into AI chats and issue trackers. The 2.0 report lifecycle produces the Markdown report, holds it in the private SNITCHSHOT buffer, and delivers it through the **COPY SNITCHSHOT** action to the system OS clipboard — not through a browser-field paste.

---

## Message types

Typical extension messages include:

```text
SNITCH
SNITCH_ACCEPTED
GET_STATUS
STATUS_RESULT
CANCEL_SNITCH
CANCEL_ACCEPTED
GET_SNITCHSHOT
SNITCHSHOT_CONTENT
CLIPBOARD_RELEASED
CLIPBOARD_CLEARED
EVIDENCE_ERROR
```

The popup-only session messages are `SNITCH`, `GET_STATUS`, `CANCEL_SNITCH`, `GET_SNITCHSHOT` and `CLIPBOARD_RELEASED`; each is refused when relayed from a tab. There is no content bridge or rolling evidence cache, so there are no `CACHE_*` / `GET_TAB_ID` / `GET_BOUNDED_OBSERVATION` / `PING` / `PONG` messages. The legacy `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` page-evidence protocol, the `PASTE_SNITCHSHOT` owned-paste protocol, and the content-bridge rolling-cache protocol have been removed.

---

## Permission posture

DEVSnitcher should request only the permissions needed to capture and protect evidence from ordinary web pages.

Current intended scope includes:

```json
"permissions": ["activeTab", "clipboardWrite", "debugger", "scripting", "tabs", "storage"],
"host_permissions": ["http://*/*", "https://*/*"]
```

The `debugger` permission exists intentionally for browser-observed provenance: DEVPEEPER uses Chromium/CDP instrumentation (`chrome.debugger`) so observation authority comes from the browser boundary rather than page-authored JavaScript messages. It attaches only to the SNITCH-selected tab, only during a live session, and enables only the minimal `Page`, `Runtime` and `Network` domains. No unrelated permission was added.

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
2. Nothing observes before SNITCH: extension start, tab activation, navigation and popup-open never attach the debugger, run a probe, or collect evidence.
3. Keep report output deterministic.
4. Keep redaction pure and testable.
5. Keep acquisition modules small.
6. Keep the popup simple. The popup renders all three CTAs and derives their enabled/labelled state from a single lifecycle projection — never from divergent UI bits.

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

DEVSnitcher is intentionally standalone: local browser evidence capture, one user-triggered SNITCH report held in a private buffer, no backend, no telemetry, no AI calls, and no rolling pre-SNITCH cache.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
