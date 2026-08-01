# DEVSnitcher Privacy Notes

DEVSnitcher is local-first.

The extension captures browser evidence from the active tab, formats it into a report, and gives that report to the user through the clipboard.

There is no DEVSnitcher cloud service in the v0.x extension.

---

## What DEVSnitcher does not do

- No DEVSnitcher account
- No DEVSnitcher backend
- No cloud upload
- No telemetry by default
- No AI service calls
- No AI vendor lock-in
- No background monitoring

Evidence stays in the browser unless the user pastes the report somewhere.

---

## What leaves the browser?

Nothing leaves the browser automatically.

DEVSnitcher does not upload captured evidence to a DEVSnitcher backend.

The user controls the next step by pasting the report into an AI chat, issue tracker, support thread, text file, or other destination.

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

The user remains in control of the report.

The intended flow is:

```text
Capture locally → Review report → Paste where chosen
```

That is the privacy boundary.

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, one SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
