# DEVSnitcher

**Press SNITCH. Paste into AI.**

Browser bugs are annoying enough already.

The last thing you should have to do is spend ten minutes copying console errors, failed requests, browser details, stack traces, and bits of HTML into a chat window just so an AI tool has enough context to help.

DEVSnitcher turns that into one action.

## The problem

When something breaks in a browser, the useful evidence is spread across several places.

You might need the console, the network panel, the page URL, the browser details, the failed request, the JavaScript error, and the part of the page you were working with.

Most of the time, developers collect that by hand.

DEVSnitcher does it for you.

## What it does

Click **SNITCH**.

DEVSnitcher builds a clean Markdown report from the browser evidence around the problem and puts it on your clipboard.

Then paste it wherever you debug:

- ChatGPT
- Claude
- Gemini
- Cursor
- Copilot
- GitHub
- Slack
- a bug report
- a text file

No account is required.

No cloud service is required.

No AI provider is built in.

## What it can capture

DEVSnitcher can collect:

- page URL and title
- browser and platform details
- viewport size
- timestamp
- console warnings and errors
- failed network requests
- HTTP status codes and request timing
- unhandled JavaScript errors
- unhandled Promise rejections
- the focused page element and useful HTML context
- an optional screenshot marker
- summary counts

## What it does not do

DEVSnitcher is not an AI agent.

It does not diagnose the bug for you.

It does not upload your data to a backend.

It does not monitor you in the background.

It captures evidence locally, removes obvious secrets where it can, builds the report, and hands it back to you.

You decide where it goes next.

## Why it is useful

AI debugging is much better when the AI gets the actual evidence instead of a description like:

> "The page is broken and there's some red stuff in the console."

DEVSnitcher gives the AI a better starting point without forcing you into another platform.

## Install for local testing

```powershell
git clone https://github.com/ArchePersona/devsnitcher.git
cd DEVSnitcher
npm install
npm run build
```

Then load the `dist/` directory as an unpacked extension in Chrome or Edge.

### Chrome

```text
chrome://extensions
Developer Mode → On
Load unpacked
Select the dist/ directory
```

### Edge

```text
edge://extensions
Developer Mode → On
Load unpacked
Select the dist/ directory
```

## Development

```powershell
npm run build
npm run typecheck
npm run lint
npm test
npm run dev
```

## The Nerd Section

DEVSnitcher is intentionally small and standalone.

It captures browser-side evidence, redacts obvious secrets, turns the result into Markdown, and copies it to the clipboard.

There is no backend, no telemetry service, no AI call, and no required account.

Deeper documentation lives here:

- [Whitepaper](docs/WHITEPAPER.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Privacy](docs/PRIVACY.md)
- [Testing](docs/TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## The ARCHETRON Ecosystem

DEVSnitcher works on its own, but it shares the same evidence-first thinking used across ARCHETRON.

- **SHERLOCK** reconstructs evidence from larger project histories.
- **ERIE** transforms disconnected data into structured evidence with context, relationships, and provenance.
- **PEEP** observes execution as it happens.
- **ARCHERAT** watches telemetry and operational behavior.
- **ARCHE** decides where cognitive attention should go next.
- **GATEHOUSE** handles authority and governance boundaries.
- **CTRL TOWER** gives people an operator view of the system.
- **ARCHESTRATOR** manages software engineering work.
- **ARCHEMADA** is the user-facing software engineering application.
- **NIRMATA** creates personas for ARCHE.

Each piece has a separate job. Together, they form **ARCHETRON**.

## License

MIT. See [LICENSE](LICENSE).
