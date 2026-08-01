# DEVSnitcher

**Press SNITCH. Paste into AI.**

DEVSnitcher is a tiny open-source browser extension that turns browser evidence into an AI-ready debugging report.

When something breaks in a web page, the normal debugging conversation starts badly:

> It does not work.
>
> What does the console say?
>
> Can you copy the network error?
>
> What browser are you using?
>
> Can you send the page state?

DEVSnitcher replaces that with one action.

Click **SNITCH**. Paste the report into ChatGPT, Claude, Gemini, Cursor, Copilot, a GitHub issue, Slack, or wherever you debug.

No accounts. No backend. No cloud. No telemetry. No AI vendor lock-in.

---

## What it is

DEVSnitcher is a local browser evidence collector.

It captures the useful debugging context from the current page and formats it as clean Markdown so an AI or human developer can understand what happened without asking for basic browser evidence first.

It is designed for web developers, technical founders, support engineers, QA testers, and anyone who needs to explain a browser bug clearly.

---

## What it is not

DEVSnitcher is not an AI agent.

It is not a diagnosis engine.

It is not a monitoring platform.

It is not a SaaS product.

It is not a dashboard.

It does not upload your data anywhere.

The extension collects evidence locally and gives you a report. You decide where to paste it.

---

## Core promise

```text
Press SNITCH.
Paste into AI.
```

That is the product.

---

## Current status

DEVSnitcher v0.1.1 is a working local extension build.

Validated so far:

- TypeScript compile: passing
- ESLint: passing
- Tests: 24/24 passing
- Build: passing
- Manual browser proof: Chrome/Chromium flow validated on localhost
- Microsoft Edge compatibility: validated through Chromium extension flow

Current tags:

```text
devsnitcher-v0.1-snitch-button
devsnitcher-v0.1-browser-proof
devsnitcher-v0.1.1-target-icon
```

Current locked release: `devsnitcher-v0.1.1-target-icon`

---

## Release checkpoints

```text
v0.1 snitch-button    Press SNITCH. Paste into AI.
v0.1 browser-proof    Content-script injection and evidence collection verified in a real browser.
v0.1.1 target-icon    Release icon + build fixes.
```

Each tag is a checkpoint on the v0.1.1 line.

---

## Icon

The DEVSnitcher icon is a dark navy square with a red target mark.

- Dark navy square
- Red target ring
- Red center dot

The icon is generated locally by `scripts/gen-icons.cjs` during the build. No icon images are committed to the repository.

---

## What DEVSnitcher captures

The generated report can include:

- Current URL
- Page title
- Browser name
- Platform
- Viewport size
- Timestamp
- Console warnings
- Console errors
- Stack traces
- Failed network requests
- HTTP status codes
- Request duration
- Unhandled exceptions
- Unhandled promise rejections
- Focused DOM element
- Selected DOM context when available
- Optional screenshot marker
- Evidence summary counts

---

## Example output

```md
# DEVSNITCHER REPORT

## User Description

Clicked Save. Nothing happened.

## Environment

- URL: http://localhost:8088/test.html
- Page title: DEVSnitcher Test Page
- Browser: Chrome
- Platform: Win32
- Viewport: 1528x732
- Timestamp: 2026-07-31T19:37:36.730Z

## Console

[2026-07-31T19:37:27.407Z] ERROR DEVSnitcher test: database connection failed

## Network

GET /api/missing-endpoint → 404 (3ms)

## JavaScript

Unhandled Promise rejection: Unexpected end of JSON input

## DOM Context

- Selector: html > body > section:nth-of-type(3) > button:nth-of-type(2)
- Tag: button
- Focused: yes

## Summary

1 console error
1 console warning
1 failed API request
1 unhandled JS error
```

---

## Privacy

DEVSnitcher is local-first.

The extension does not create an account, call a DEVSnitcher server, or send captured evidence to a backend.

The output path is the clipboard. You decide where the report goes.

Because browser evidence can contain sensitive data, DEVSnitcher includes best-effort redaction for obvious secrets before report generation.

---

## Redaction

DEVSnitcher attempts to redact common sensitive values, including:

- Authorization headers
- Bearer tokens
- Cookies
- API-key-looking values
- Token-looking URL parameters
- Password-looking values

Redaction is best effort. Always review the report before pasting it into a third-party AI chat or public issue.

---

## Install for local testing

Clone the repo:

```powershell
git clone https://github.com/ArchePersona/devsnitcher.git
cd DEVSnitcher
```

Install dependencies:

```powershell
npm install
```

Build the extension:

```powershell
npm run build
```

Load it in Chrome or Edge:

```text
chrome://extensions
Developer Mode → On
Load unpacked
Select the dist/ directory
```

For Edge:

```text
edge://extensions
Developer Mode → On
Load unpacked
Select the dist/ directory
```

---

## Manual test

Start a local test server:

```powershell
cd D:\DEVSnitcher
python -m http.server 8088
```

Open:

```text
http://localhost:8088/test.html
```

Trigger the test buttons, then click **SNITCH**.

Paste the clipboard into a text file or AI chat and confirm the report includes environment, console, network, JavaScript, DOM context, and summary sections.

---

## Development commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Expected verification before commit:

```text
TypeScript: clean
ESLint: clean
Tests: passing
Build: dist/ generated
```

---

## Architecture

```text
Popup
  └─ User clicks SNITCH

Background service worker
  └─ Finds active tab
  └─ Ensures content script is available
  └─ Requests evidence
  └─ Builds final report

Content bridge
  └─ Talks across the browser boundary
  └─ Requests page evidence
  └─ Returns evidence to background

Page script
  └─ Runs in the page context
  └─ Captures console, network, JS errors, DOM context

Collectors
  └─ Environment
  └─ Console
  └─ Network
  └─ JavaScript
  └─ DOM
  └─ Screenshot

Redaction
  └─ Headers
  └─ Cookies
  └─ Tokens
  └─ URLs

Report
  └─ Markdown
  └─ JSON
  └─ Clipboard
```

The code is intentionally modular. No god files. No backend dependency. No dashboard dependency.

---

## Project layout

```text
collectors/       Evidence collectors
redaction/        Pure redaction helpers
report/           Markdown, JSON, and clipboard output
shared/           Shared TypeScript types
extension/        Browser extension source
  background/     Service worker and evidence coordinator
  content/        Content bridge and page script injection
  popup/          SNITCH button UI
scripts/          Build and test scripts
tests/            Unit tests
docs/             Additional project documentation
```

---

## Design rules

1. Evidence first. AI second.
2. One button must remain the primary product experience.
3. No account required.
4. No backend required.
5. No telemetry by default.
6. No AI vendor lock-in.
7. Reports must be useful when pasted into any AI chat.
8. Every collected field must help diagnose a browser problem.
9. Keep the codebase small enough for contributors to understand quickly.
10. Prefer deterministic output over clever behavior.

---

## Open source

DEVSnitcher is open source under the MIT License.

You can use it, fork it, modify it, inspect it, and contribute to it.

The point of the project is simple: developers should be able to capture browser evidence without trusting a cloud service or buying into a platform.

---

## Beyond a Single SNITCH

DEVSnitcher is built for the fast debugging moment:

```text
Something broke.
Press SNITCH.
Paste the report into AI.
```

For deeper investigations, the same evidence-first idea continues in **SHERLOCK**.

DEVSnitcher captures browser evidence from one debugging moment.

SHERLOCK is designed for larger evidence reconstruction: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

SHERLOCK does not need to be installed to use DEVSnitcher.

They share the same principle:

```text
Evidence first. AI second.
```

SHERLOCK is currently part of a hackathon build, and I am trying to turn it into real sales as a bootstrapped founder.

If DEVSnitcher helps you, please consider supporting the work by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```

---

## Contributing

Contributions are welcome, but v0.x should stay small.

Good contribution areas:

- Better redaction rules
- Cleaner report formatting
- More reliable browser compatibility
- Tests for collectors and redaction
- Documentation improvements
- Accessibility improvements in the popup
- Bug fixes around content-script injection

Avoid for now:

- Accounts
- Cloud sync
- Dashboards
- Built-in AI diagnosis
- Long-running monitoring
- Vendor-specific AI integrations
- Large framework migrations

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## Security

Please do not open a public issue for sensitive security reports.

See [SECURITY.md](SECURITY.md) for the security policy.

---

## License

MIT. See [LICENSE](LICENSE).
