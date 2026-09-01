# DEVSnitcher Architecture

DEVSnitcher is built as a small browser extension with a strict local-first evidence flow.

The core path is:

```text
Page Script → Collectors → Content Bridge → Background → Encrypted Session Cache
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

1. The page script observes browser evidence in page context.
2. The isolated content bridge periodically requests the current evidence snapshot.
3. The content bridge sends accepted evidence to the background service worker through the extension runtime.
4. Background validates the evidence payload, encrypts valid evidence with AES-256-GCM, and writes only ciphertext plus required metadata to `chrome.storage.session`.
5. User opens the popup, optionally enters a short description, and clicks **SNITCH**.
6. Popup sends `SNITCH` to the background service worker.
7. Background refuses tab-relayed `SNITCH` messages and resolves the active tab only for the popup-originated action.
8. Background ensures the content script is present.
9. Background prefers the existing encrypted cache; if no usable cache exists, it may request one immediate refresh.
10. Background decrypts the cache inside trusted extension context and validates the decrypted evidence shape.
11. Background optionally captures the user-requested screenshot.
12. Background applies redaction and builds the report.
13. Popup writes the report to the clipboard.
14. User pastes the report into AI or another debugging channel.

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

The page script and ordinary page JavaScript share the page execution environment. The current page-facing evidence transport uses `window.postMessage` for `COLLECT_EVIDENCE` / `EVIDENCE_RESULT`.

Encryption begins only after the extension accepts that evidence. Therefore the encrypted cache protects accepted evidence at rest; it does **not** cryptographically prove that the original page-context evidence producer was genuine.

Forged page evidence before cache ingestion remains a separate evidence-integrity concern.

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
- Capture screenshot evidence when explicitly requested by SNITCH
- Apply redaction
- Build the report payload
- Return output to the popup

The background worker should not become a dashboard, analytics layer, or hosted monitor.

---

### Content bridge

The content bridge runs in the isolated extension world.

Responsibilities:

- Respond to PING/PONG checks
- Periodically request evidence from the page script
- Prevent overlapping rolling-cache refreshes
- Send accepted evidence to background with `CACHE_EVIDENCE`
- Receive explicit `REFRESH_CACHE` fallback requests from background

The content bridge does not hold the encryption/decryption key and must not accept page-originated `SNITCH` commands or forward page-controlled requests into privileged extension behavior.

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

The page script should collect evidence only. It should not diagnose, access the encrypted cache, hold its key, or initiate privileged extension actions.

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

Typical extension and page-evidence messages include:

```text
SNITCH
PING
PONG
COLLECT_EVIDENCE
EVIDENCE_RESULT
EVIDENCE_ERROR
CACHE_EVIDENCE
CACHE_STORED
REFRESH_CACHE
CACHE_REFRESHED
```

`SNITCH` belongs only to the extension message path initiated by the popup and is rejected when relayed from a tab. Cache messages belong to the extension runtime path. `COLLECT_EVIDENCE` and `EVIDENCE_RESULT` belong to the narrow page-evidence bridge.

---

## Permission posture

DEVSnitcher should request only the permissions needed to capture and protect evidence from ordinary web pages.

Current intended scope includes:

```json
"permissions": ["activeTab", "scripting", "clipboardWrite", "tabs", "storage"],
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
- Persistent evidence storage beyond the browser session
- Analytics by default
- Vendor-specific AI flows
- Large application frameworks

Those may be separate products later. They do not belong in the core v0.x extension.

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
10. Keep collectors small.
11. Keep the popup simple.

---

## Ecosystem Note

DEVSnitcher is intentionally standalone.

It may later export into SHERLOCK-style evidence workflows, but v0.1.x has no backend, no SHERLOCK dependency, and no external upload path.

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
