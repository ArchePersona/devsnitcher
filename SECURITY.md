# Security Policy

DEVSnitcher captures browser evidence. That evidence can include sensitive information.

The project is designed to be local-first and transparent, but users should still review generated reports before pasting them into any third-party AI chat, public issue, or shared support channel.

---

## Supported versions

During the 2.x phase, security fixes will target the latest version on the `main` branch.

| Version | Supported |
|---|---|
| 2.x | Yes |
| older tags | No |

---

## Security model

DEVSnitcher is designed around these constraints:

- No DEVSnitcher account
- No DEVSnitcher backend
- No cloud upload
- No telemetry by default
- DEVSnitcher-owned SNITCHSHOT copy to the system clipboard, initiated from the popup
- Best-effort redaction before report generation
- User decides where the report is pasted
- Only the extension popup may initiate the privileged `SNITCH` action
- Background explicitly refuses `SNITCH` messages that arrive with a tab sender
- The private SNITCHSHOT buffer is stored in trusted, session-scoped extension storage; page JavaScript and content scripts cannot read or clear it
- `COPY SNITCHSHOT` is popup-initiated, refused when relayed from a tab, and the buffer is cleared only after a confirmed successful system-clipboard write
- Page JavaScript must not be able to invoke privileged extension actions through the content bridge
- Cache-write evidence is shape-validated before encryption
- Accepted rolling evidence is encrypted before it is written to extension session storage
- The cache encryption key remains in trusted extension context
- Per-tab cache records are cleared on tab close and navigation/load
- Environment/DOM observations are acquired through `chrome.scripting.executeScript` and carried back in Chrome's `InjectionResult`, not through a page-authored message
- Chromium observations are acquired through `chrome.debugger` attached only to the SNITCH-selected tab and only for the live session (never before SNITCH, never on tab activation), with browser-issued provenance; the `debugger` permission is required for this browser-observed path
- Browser-observed console, runtime-error and network evidence comes only from the trusted Chromium observer bound to the SNITCH-selected tab during the live session; no page-authored value supplies authoritative evidence
- Chromium identifiers are provenance, not durable source identity (no `SourceIdentity`, no per-navigation source rollover)

The legacy `window.postMessage` page-evidence bus has been removed. There is no page-facing message bridge carrying evidence, no MAIN-world evidence collector is injected, and DEVSnitcher posts no evidence protocol the page can participate in. It is not a general command channel into the extension service worker.

---

## Privilege boundary

The browser page and the extension run in different trust domains.

DEVSnitcher therefore treats page-controlled messages as untrusted input. Page JavaScript must not be able to:

- initiate `SNITCH`
- request screenshot capture
- receive `SNITCH_RESULT`
- use the content script as a proxy for privileged extension APIs
- read the encrypted evidence cache through ordinary page JavaScript
- obtain the cache encryption key
- request arbitrary cache decryption

The intended privileged path begins with an explicit user action in the extension popup.

```text
User clicks SNITCH → Popup → Background → Session observer → Redact → Report → Private buffer → COPY SNITCHSHOT → System clipboard
```

The background service worker enforces the popup-only boundary directly. A `SNITCH` message carrying a `sender.tab` is refused rather than resolved as an authorized source tab.

---

## Encrypted evidence cache

DEVSnitcher maintains a browser-session rolling evidence cache so the normal SNITCH path can use evidence accumulated before the click without asking the page for a new trusted answer at that moment.

Accepted evidence reaches the background service worker through the extension runtime. Background validates its expected shape, then encrypts it with AES-256-GCM before writing the cache record to `chrome.storage.session`. Malformed cache-write payloads are rejected.

Current cache protections include:

- AES-256-GCM authenticated encryption
- fresh random IV for each encryption operation
- authenticated additional data bound to the tab cache identity
- session-scoped generated encryption key
- `chrome.storage.session` access restricted to `TRUSTED_CONTEXTS`
- per-tab encrypted records
- evidence-shape validation before storage and after decryption
- URL mismatch rejection for stale page records
- cache removal when a tab closes
- cache clearing when a tab navigates or begins loading a new page

Plaintext evidence is not intentionally persisted as the cache representation.

The key is not sent to the page or content script.

Modification of authenticated ciphertext or IV should cause decryption failure rather than silently yielding modified evidence. A cache record bound to a different tab must also fail authentication because the tab identity is part of AES-GCM authenticated additional data.

---

## What encryption does not prove

The encrypted cache protects evidence **after DEVSnitcher accepts it for caching**.

It does not authenticate the original producer of all evidence inside page context.

DEVSnitcher has three evidence sources with different authenticity properties:

**Browser-observed (Chromium/CDP).** Chromium-issued events — including console (`Runtime.consoleAPICalled`), runtime errors (`Runtime.exceptionThrown`) and network (`Network.requestWillBeSent`/`responseReceived`/`loadingFinished`/`loadingFailed`) — are received through `chrome.debugger` attached only to the tab selected by SNITCH and only for the duration of that session. NO observer is attached before SNITCH: tab activation, navigation, extension start and popup-open never attach the debugger. Browser-issued provenance (`tabId`, `frameId`, `loaderId`, `executionContextId`, `scriptId`, `requestId`, `timestamp`, etc.) is preserved. The `debugger` permission is required for this path. Network normalization retains only HTTP failures (status `>= 400`) or browser-reported failures (status `0`) and fetches response bodies only for retained HTTP failures, bounded to 1000 characters and 100 entries per session.

**Chrome-mediated bounded observations (browser-returned).** Environment, focused DOM and current selection are acquired through `chrome.scripting.executeScript` from extension-controlled code. Chrome returns the result to the extension inside an `InjectionResult`, so a hostile page calling `window.postMessage` cannot forge or substitute these bounded observations.

For both browser-mediated paths, Chrome authenticates the transport path to the extension. This does **not** make the observed page state semantically truthful: the webpage can still influence the DOM, focus, selection, console output, network behavior and lifecycle it exposes. Correlating page-visible state with a tab ID, URL, timestamp, or document identity does **not** promote it to browser-observed provenance.

There is no page-reported evidence ingress. The legacy `window.postMessage` `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` bus has been removed, DEVSnitcher injects no MAIN-world evidence collector, and no authoritative evidence originates from a page-authored message. A hostile page has no DEVSnitch evidence protocol it can participate in by emitting `window.postMessage`; browser-observed console/runtime/network evidence comes only from the trusted Chromium observer bound to the tab selected by SNITCH during the live session, events from another tab/debugger target are rejected, and stale observations from a detached/replaced attachment are not reused. So no observer exists before a SNITCH press: absent a live session the debugger is never attached.

Therefore DEVSnitcher must not claim that Chrome-mediated observation makes page-controlled state truthful. Browser-observed provenance is provenance of observation, not truthfulness of the page's behavior.

This distinction matters:

```text
Privileged-action authorization: protected by popup-only background enforcement.
Stored-cache confidentiality/integrity: protected by extension-owned AES-GCM encryption and validation.
Browser-mediated transport authenticity: bounded probe return authenticated by Chrome's InjectionResult; Chromium console/runtime/network events via chrome.debugger (chrome-scripting / chrome-debugger).
Page-evidence ingress authenticity: not applicable — the page-reporting bus has been removed; no evidence originates from a page-authored message.
```

---

## Sensitive data

Browser debugging evidence can contain secrets, including:

- Cookies
- Authorization headers
- Bearer tokens
- API keys
- Session IDs
- User identifiers
- Private URLs
- Request bodies
- Stack traces with internal paths

DEVSnitcher performs best-effort redaction for obvious secrets such as authorization headers, bearer tokens, cookies, passwords, and API-key-like values. Users should still review reports before pasting them into an AI chat, issue tracker, or shared channel.

Encryption of the local session cache does not replace redaction. Redaction still occurs before report output because the user may paste that output outside the browser.

---

## Reporting a vulnerability

Please do not open a public GitHub issue for sensitive security problems.

For now, report security concerns privately to the repository owner through GitHub profile contact paths or a private channel already established with the maintainer.

A useful security report should include:

- What happened
- Steps to reproduce
- Browser and OS
- DEVSnitcher version or commit
- Why the behavior is unsafe
- Whether sensitive data was exposed

---

## Examples of security bugs

Please report issues such as:

- A secret not being redacted when it clearly should be
- Evidence being sent over the network unexpectedly
- Extension access on browser-internal pages
- The SNITCHSHOT buffer being cleared when the system clipboard write has not been confirmed, losing a pending report
- A permission that is broader than needed
- A content-script injection bug
- A cross-origin evidence leak
- Page-controlled or tab-relayed messages invoking privileged extension behavior
- Plaintext evidence being persisted where the encrypted cache is expected
- A page or content script gaining access to the cache key
- Malformed cache evidence being accepted for storage
- Tampered cache ciphertext or IV being accepted without authentication failure
- One tab consuming another tab's cached evidence
- Stale cache surviving navigation and being consumed for a different page
- Forged or untrusted page evidence being accepted as trusted extension output
- The debugger being attached beyond the SNITCH-selected tab during a session, attached before any SNITCH press, or CDP driving privileged/execution behavior rather than passive observation
- Page-visible state being mislabeled or promoted to browser-observed provenance by correlation
- A Chromium observation associated with the wrong tab, or surviving after Chrome detaches the session
- Page-authored `window.postMessage` traffic masquerading as a DEVSnitch evidence protocol (no such protocol exists)
- Browser-observed console/runtime/network evidence from another tab, or stale evidence from a replaced/detached attachment, being reused
- A network response body being fetched for anything other than a retained HTTP failure, or a retained network failure exceeding the 100-entry / 1000-character bounds

---

## Non-security bugs

Use normal GitHub issues for regular bugs, UI polish, documentation fixes, or feature requests.

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, encrypted browser-session cache, one user-triggered SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
