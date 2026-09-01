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
- Only the extension UI may initiate the privileged `SNITCH` action
- Page JavaScript must not be able to invoke privileged extension actions through the content bridge

The page-facing message bridge is limited to evidence collection. It is not a general command channel into the extension service worker.

---

## Privilege boundary

The browser page and the extension run in different trust domains.

DEVSnitcher therefore treats page-controlled messages as untrusted input. Page JavaScript must not be able to:

- initiate `SNITCH`
- request screenshot capture
- receive `SNITCH_RESULT`
- use the content script as a proxy for privileged extension APIs

The intended privileged path begins with an explicit user action in the extension popup.

```text
User clicks SNITCH → Popup → Background → Evidence collection → Popup → Clipboard
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
- Page-controlled messages invoking privileged extension behavior
- Forged or untrusted page evidence being accepted as trusted extension output

---

## Non-security bugs

Use normal GitHub issues for regular bugs, UI polish, documentation fixes, or feature requests.

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, one SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
