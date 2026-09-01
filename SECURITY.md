# Security Policy

DEVSnitcher captures browser evidence. That evidence can include sensitive information.

The project is designed to be local-first and transparent, but users should still review generated reports before pasting them into any third-party AI chat, public issue, or shared support channel.

---

## Supported versions

During the early v0.x phase, security fixes will target the latest version on the `main` branch.

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| older tags | No |

---

## Security model

DEVSnitcher is designed around these constraints:

- No DEVSnitcher account
- No DEVSnitcher backend
- No cloud upload
- No telemetry by default
- Clipboard-based output
- Best-effort redaction before report generation
- User decides where the report is pasted
- Only the extension popup may initiate the privileged `SNITCH` action
- Background explicitly refuses `SNITCH` messages that arrive with a tab sender
- Page JavaScript must not be able to invoke privileged extension actions through the content bridge
- Cache-write evidence is shape-validated before encryption
- Accepted rolling evidence is encrypted before it is written to extension session storage
- The cache encryption key remains in trusted extension context
- Per-tab cache records are cleared on tab close and navigation/load

The page-facing message bridge is limited to evidence collection. It is not a general command channel into the extension service worker.

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
User clicks SNITCH → Popup → Background → Decrypt cache → Redact → Report → Popup → Clipboard
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

It does not authenticate the original producer of evidence inside page context.

The current page-facing `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` transport uses `window.postMessage`. Ordinary page JavaScript shares that environment with the injected page script and may attempt to forge evidence before the content bridge passes it into the trusted extension runtime.

Therefore DEVSnitcher must not claim that the encrypted cache provides end-to-end evidence provenance.

This distinction matters:

```text
Privileged-action authorization: protected by popup-only background enforcement.
Stored-cache confidentiality/integrity: protected by extension-owned AES-GCM encryption and validation.
Original page-evidence authenticity: separate unresolved trust-boundary concern.
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
- Clipboard output containing hidden or unintended data
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
