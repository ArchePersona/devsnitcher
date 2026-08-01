# DEVSnitcher

**Press SNITCH. Paste into AI.**

DEVSnitcher is a tiny open-source browser extension that turns browser evidence into an AI-ready debugging report.

When a browser bug happens, developers usually have to manually copy console errors, failed network requests, stack traces, browser details, and DOM context.

DEVSnitcher turns that into one action.

```text
Click SNITCH.
Paste the report into ChatGPT, Claude, Gemini, Cursor, Copilot, GitHub, Slack, or wherever you debug.
```

No accounts. No backend. No cloud. No telemetry. No AI vendor lock-in.

---

## What it captures

DEVSnitcher can capture:

- URL, page title, browser, platform, viewport, and timestamp
- Console warnings and errors
- Failed network requests
- HTTP status codes and request duration
- Unhandled JavaScript exceptions
- Unhandled Promise rejections
- Focused DOM element and relevant HTML context
- Optional screenshot marker
- Summary counts

---

## What it is not

DEVSnitcher is not an AI agent.

It is not a diagnosis engine.

It is not a monitoring platform.

It is not a SaaS product.

It does not upload your data anywhere.

It captures evidence locally, redacts obvious secrets, builds a Markdown report, and puts it on your clipboard.

You decide where to paste it.

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

Load it in Chrome:

```text
chrome://extensions
Developer Mode → On
Load unpacked
Select the dist/ directory
```

Load it in Edge:

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

## Development

```powershell
npm run build
npm run typecheck
npm run lint
npm test
npm run dev
```

Current validation:

```text
Build: passing
TypeScript: passing
ESLint: passing
Tests: 24/24 passing
Chrome/Chromium: manually validated
Microsoft Edge: manually validated
```

---

## Current release

Current locked release:

```text
devsnitcher-v0.1.1-target-icon
```

Current icon:

```text
dark navy square
red target ring
red center dot
```

Release notes are available in [CHANGELOG.md](CHANGELOG.md).

---

## Documentation

Deeper docs:

- [Whitepaper](docs/WHITEPAPER.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Privacy](docs/PRIVACY.md)
- [Testing](docs/TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

---

## Open source

DEVSnitcher is open source under the MIT License.

You can use it, fork it, modify it, inspect it, and contribute to it.

The point of the project is simple: developers should be able to capture browser evidence without trusting a cloud service or buying into a platform.

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, one SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```

---

## License

MIT. See [LICENSE](LICENSE).
