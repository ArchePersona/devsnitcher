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

DEVSnitcher builds a clean Markdown report from the browser evidence around the problem and holds it in a private DEVSnitcher buffer.

Then focus an editable field (a chat input, issue comment, or text box), and use the popup's **PASTE SNITCHSHOT** to insert the report — exactly where your cursor is.

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

Evidence comes straight from the browser on the active tab:

- **Browser-observed** (Chromium/CDP, through `chrome.debugger`) — console warnings/errors, runtime JavaScript failures, and failed network requests carry browser-issued provenance.
- **Browser-returned** (bounded `chrome.scripting` probe) — environment, DOM context, and selection are returned by Chrome inside its own `InjectionResult`.
- **Optional screenshot** — captured only when you request it on SNITCH.

DEVSnitcher works only on the tab you are looking at. It reports where an observation came from (browser vs. page), and provenance of that kind describes the acquisition path — not a claim that the page's behavior is truthful.

## What it does not do

DEVSnitcher is not an AI agent.

It does not diagnose the bug for you.

It does not upload your data to a backend.

It does not monitor you in the background.

It captures browser evidence locally, removes obvious secrets where it can, builds the report, and hands it back to you.

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

It captures browser-side evidence, redacts obvious secrets, turns the result into Markdown, and holds it in a private DEVSnitcher buffer until you paste it into an editable field with **PASTE SNITCHSHOT**.

There is no backend, no telemetry service, no AI call, and no required account.

Deeper documentation lives here:

- [Whitepaper](docs/WHITEPAPER.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Privacy](docs/PRIVACY.md)
- [Testing](docs/TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## The ARCHETRON Ecosystem

DEVSnitcher is the browser evidence-capture utility in the ARCHETRON ecosystem.

It is intentionally standalone: it does not require the rest of ARCHETRON, and the rest of ARCHETRON does not need to sit inside DEVSnitcher. Its job is narrower and useful on its own — capture the evidence already present around a browser failure and make that evidence immediately portable.

That puts DEVSnitcher at the edge of the larger evidence-first architecture:

```text
BROWSER FAILURE
      │
      ▼
 DEVSnitcher
 capture + redact + package
      │
      ├──────────────► AI / issue / chat / human debugger
      │
      └──────────────► evidence workflows
                           │
                           ▼
                    SHERLOCK / ERIE
```

The ecosystem pieces keep separate jobs:

- **DEVSnitcher** captures local browser evidence and packages it for immediate use.
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

The shared principle is not that every tool must be coupled together. It is that intelligence works better when observation, evidence, reasoning, authority, and action are kept distinguishable.

Each piece has a separate job. Together, they form **ARCHETRON**.

## License

MIT. See [LICENSE](LICENSE).
