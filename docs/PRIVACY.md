# DEVSnitcher Privacy Notes

DEVSnitcher is local-first.

The extension captures browser evidence, maintains an encrypted browser-session cache, formats user-requested evidence into a report, and gives that report to the user through the clipboard.

There is no DEVSnitcher cloud service in the v0.x extension.

---

## What DEVSnitcher does not do

- No DEVSnitcher account
- No DEVSnitcher backend
- No cloud upload
- No telemetry by default
- No AI service calls
- No AI vendor lock-in
- No persistent evidence storage beyond the browser session

Evidence stays in the browser unless the user pastes the report somewhere.

---

## What leaves the browser?

Nothing leaves the browser automatically.

DEVSnitcher does not upload captured evidence to a DEVSnitcher backend.

The user controls the next external step by pasting the report into an AI chat, issue tracker, support thread, text file, or other destination.

---

## Local rolling evidence cache

DEVSnitcher observes debugging evidence before the user presses SNITCH so the resulting report can include the events that led up to the problem.

The extension periodically moves an evidence snapshot into extension-owned browser-session storage. The trusted background service worker first validates the evidence payload, then encrypts accepted evidence with AES-256-GCM before the cache record is written.

The cache is:

- local to the browser
- session-scoped
- stored through `chrome.storage.session`
- restricted to trusted extension contexts
- shape-validated before encryption
- encrypted before the evidence record is persisted
- isolated per tab/page identity
- removed per tab when that tab closes
- cleared when the tab navigates or begins loading a new page

The encryption key remains in trusted extension context and is not provided to the webpage or content script.

The cache is not uploaded anywhere by DEVSnitcher.

---

## User-initiated privileged capture

The privileged `SNITCH` action begins from the extension popup when the user clicks **SNITCH**.

The background service worker enforces that boundary directly: a `SNITCH` message arriving with a tab sender is refused. Page JavaScript is not allowed to initiate `SNITCH`, request screenshot capture through that command, or receive the privileged `SNITCH_RESULT` response.

SNITCH normally reads and decrypts the existing local encrypted cache. If no usable cache exists, the extension may request an immediate local refresh as fallback.

Screenshot capture remains tied to the user-triggered SNITCH path.

---

## Evidence authenticity limitation

Cache encryption protects accepted evidence while it is stored by the extension. It does not prove that every observation originally produced in page context is authentic.

Environment, focused DOM and current selection are now acquired through `chrome.scripting.executeScript` and returned to the extension inside Chrome's `InjectionResult`, so a hostile page cannot forge those bounded observations by calling `window.postMessage`. Chrome authenticates that transport path; the page can still influence the underlying DOM/focus state it exposes.

Console, network and JavaScript-error evidence still travel over the legacy page-facing `window.postMessage` bridge. A hostile webpage may attempt to fabricate that console/network/error evidence before the extension accepts and encrypts it. This console/network/error ingress remains unresolved pending later DEVPEEPER milestones.

This is an evidence-integrity limitation, not a cloud-privacy change: the data still remains local unless the user chooses to paste the resulting report elsewhere.

DEVSnitcher should not describe encrypted caching as end-to-end cryptographic provenance, nor claim that Chrome-mediated execution makes page-controlled state semantically truthful.

---

## What may be captured?

Depending on page activity, DEVSnitcher may capture:

- URL
- Page title
- Browser and platform
- Viewport size
- Timestamp
- Console logs, warnings, and errors
- Stack traces
- Failed network request metadata
- JavaScript exceptions
- Promise rejections
- Focused or selected DOM context
- Screenshot marker or screenshot output where supported

---

## Sensitive data risk

Browser evidence can contain sensitive information.

Examples:

- Session cookies
- Authorization headers
- Bearer tokens
- API keys
- Private URLs
- Internal hostnames
- User IDs
- Email addresses
- Stack traces with private paths
- Request or response previews

DEVSnitcher includes redaction, but no automatic redaction system is perfect.

Encryption protects the local cache representation; it does not make report output safe to share automatically.

Review reports before sharing them.

---

## Redaction stance

DEVSnitcher applies best-effort redaction before report generation.

The project should continue improving redaction rules, but it should never claim perfect protection.

Safe wording:

```text
Best-effort redaction is included. Review before sharing.
```

Unsafe wording:

```text
DEVSnitcher guarantees no secrets will leak.
```

---

## Telemetry

DEVSnitcher should not include telemetry by default.

If telemetry is ever proposed, it must be:

- Explicit
- Optional
- Documented
- Disabled by default
- Easy to inspect
- Easy to remove

---

## AI providers

DEVSnitcher does not require a specific AI provider.

The report can be pasted into any AI chat or sent to a human developer.

This avoids AI vendor lock-in and keeps the extension useful even without an AI account.

---

## User control

The extension may locally observe, validate, and encrypt debugging evidence before the click, but privileged report generation and optional screenshot capture remain user-triggered.

The intended flow is:

```text
Observe locally → Validate → Encrypt session cache → User clicks SNITCH → Decrypt locally → Redact → Report → Paste where chosen
```

Nothing is automatically uploaded by DEVSnitcher.

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, encrypted browser-session cache, one user-triggered SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
