# DEVSnitcher Architecture

DEVSnitcher is built as a small browser extension with a strict local-first evidence flow.

The core path is:

```text
Popup → Background → Content Bridge → Page Script → Collectors → Redaction → Report → Clipboard
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

1. User opens the popup.
2. User optionally enters a short description.
3. User clicks **SNITCH**.
4. Popup sends a SNITCH request to the background service worker.
5. Background finds the active tab.
6. Background checks whether the content script is present.
7. If needed, background injects the content script.
8. Content bridge requests evidence from the page script.
9. Page script collects browser evidence from the page context.
10. Evidence returns to the background service worker.
11. Background applies redaction and builds the report.
12. Popup writes the report to the clipboard.
13. User pastes the report into AI or another debugging channel.

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

The background service worker coordinates evidence collection.

Responsibilities:

- Resolve the active tab
- Reject unsupported browser-internal pages
- Ping the content script
- Inject the content script only when needed
- Request evidence from the content bridge
- Capture screenshot evidence when supported
- Apply redaction
- Build the report payload
- Return output to the popup

The background worker should not become a dashboard, analytics layer, or long-running monitor.

---

### Content bridge

The content bridge runs in the isolated extension world.

Responsibilities:

- Respond to PING/PONG checks
- Receive COLLECT_EVIDENCE from background
- Bridge requests into the page context
- Wait for EVIDENCE_RESULT or EVIDENCE_ERROR
- Send results back through the extension message response

The bridge exists because extension context and page context are separated by the browser.

---

### Page script

The page script runs in the page context.

Responsibilities:

- Patch safe browser APIs needed for evidence capture
- Observe console calls
- Observe failed network requests
- Observe JavaScript errors and promise rejections
- Capture DOM context
- Return evidence when asked

The page script should collect evidence only. It should not diagnose.

---

### Collectors

Collectors are focused evidence modules.

Current collector categories:

- Environment
- Console
- Network
- JavaScript errors
- DOM context
- Screenshot

Collectors should answer one question:

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

Redaction should happen before report output.

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

Typical message flow includes:

```text
SNITCH
PING
PONG
COLLECT_EVIDENCE
EVIDENCE_RESULT
EVIDENCE_ERROR
```

The preferred evidence flow is request/response, not broad forwarding through global listeners.

---

## Permission posture

DEVSnitcher should request only the permissions needed to capture evidence from ordinary web pages.

Current intended scope:

```json
"host_permissions": ["http://*/*", "https://*/*"]
```

Browser-internal pages such as `chrome://`, `edge://`, and `chrome-extension://` should not be inspected.

---

## Non-goals

The architecture should not add:

- Accounts
- Hosted storage
- SaaS backend
- Built-in AI diagnosis
- Long-running monitoring
- Analytics by default
- Vendor-specific AI flows
- Large application frameworks

Those may be separate products later. They do not belong in the core v0.x extension.

---

## Stability rules

1. Prefer lazy injection over tab-wide eager injection.
2. Do not inject on every tab update. The tab-update injection path was removed in v0.1.1 in favor of the PING/PONG handshake with lazy fallback injection.
3. Keep one clear evidence request path.
4. Guard against double-injection.
5. Keep report output deterministic.
6. Keep redaction pure and testable.
7. Keep collectors small.
8. Keep the popup simple.

---

## Ecosystem Note

DEVSnitcher is intentionally standalone.

It may later export into SHERLOCK-style evidence workflows, but v0.1.x has no backend, no SHERLOCK dependency, and no external upload path.

DEVSnitcher captures one browser debugging moment.

SHERLOCK is designed for deeper evidence reconstruction across files, conversations, timelines, source artifacts, provenance, and investigation reports.

SHERLOCK is currently part of a hackathon build and is also the commercial support path for the broader evidence-first work.

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

DEVSnitcher is intentionally standalone: local browser evidence capture, one SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
