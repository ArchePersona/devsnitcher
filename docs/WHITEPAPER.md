# DEVSnitcher Whitepaper

## Press SNITCH. Paste into AI.

DEVSnitcher is a tiny open-source browser extension that turns browser evidence into an AI-ready debugging report.

It exists because most AI debugging conversations start with missing evidence.

A user says:

> It does not work.

Then the AI has to ask:

> What does the console say?
>
> What failed in Network?
>
> What browser are you using?
>
> What page were you on?
>
> Can you share the DOM context?

DEVSnitcher replaces that back-and-forth with one local action:

```text
Press SNITCH.
Paste into AI.
```

## The Problem

AI debugging is often weak because the prompt is weak.

The user describes the symptom, but the important browser evidence is missing.

That causes unnecessary follow-up questions, wrong guesses, and wasted time.

The browser already has much of the evidence:

- console errors
- warnings
- failed requests
- stack traces
- runtime exceptions
- promise rejections
- URL and environment
- relevant DOM context

But copying that information manually is annoying.

Most developers skip it.

DEVSnitcher makes the useful evidence easy to capture.

## The Principle

```text
Evidence first. AI second.
```

DEVSnitcher does not try to diagnose the problem.

It does not call an AI.

It does not guess.

It captures browser evidence, redacts obvious secrets, formats the result into a Markdown report, and holds it in a private DEVSnitcher buffer until the user pastes it into an editable field.

The user decides where the report goes.

## What DEVSnitcher Is

DEVSnitcher is a local browser evidence collector.

It is designed for:

- web developers
- technical founders
- support engineers
- QA testers
- anyone explaining a browser bug to an AI or another human

It creates a Markdown report that can be pasted into:

- ChatGPT
- Claude
- Gemini
- Cursor
- Copilot
- GitHub issues
- Slack
- Discord
- email
- any normal text field

## What DEVSnitcher Is Not

DEVSnitcher is not an AI agent.

It is not a diagnosis engine.

It is not a monitoring platform.

It is not a SaaS product.

It is not a dashboard.

It does not upload your data anywhere.

It does not require an account.

It does not require a backend.

It does not require SHERLOCK.

## Evidence Captured

The generated report can include:

- current URL
- page title
- browser name
- platform
- viewport size
- timestamp
- console warnings
- console errors
- stack traces
- failed network requests
- HTTP status codes
- request duration
- unhandled exceptions
- unhandled Promise rejections
- focused DOM element
- selected DOM context when available
- optional screenshot marker
- evidence summary counts

## Example Report

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

## Privacy Model

DEVSnitcher is local-first.

The extension does not create an account, call a DEVSnitcher server, or send captured evidence to a backend.

The output path is DEVSnitcher's own **PASTE SNITCHSHOT** action into an editable field.

The user controls where the report goes.

Because browser evidence can contain sensitive data, DEVSnitcher includes best-effort redaction before report generation.

## Redaction Model

DEVSnitcher attempts to redact common sensitive values, including:

- authorization headers
- bearer tokens
- cookies
- API-key-looking values
- token-looking URL parameters
- password-looking values

Redaction is best effort.

Users should always review the report before pasting it into a third-party AI chat, public issue, or shared channel.

## Architecture Summary

```text
Popup
  └─ User clicks SNITCH

Background service worker
  └─ Finds active tab
  └─ Ensures content script is available
  └─ Attaches active-tab Chromium observer (Page, Runtime, Network)
  └─ Observes console, runtime errors and failed network browser-observed
  └─ Assembles and encrypts evidence; redacts; builds final report

Content bridge
  └─ Runs in the isolated extension world
  └─ Executes the Chrome-mediated bounded probe (environment/DOM/selection)
  └─ Streams accepted evidence to the background

DEVPEEPER
  └─ Bounded probe (chrome-scripting): environment, DOM, selection
  └─ Chromium observer (chrome-debugger): console, runtime errors, network
  └─ Optional user-requested screenshot

Redaction
  └─ Headers
  └─ Cookies
  └─ Tokens
  └─ URLs

Report
  └─ Markdown report (primary product format)
  └─ JSON report
  └─ Held in a private DEVSnitcher buffer and inserted via PASTE SNITCHSHOT
```

## Project Layout

```text
devpeeper/         Evidence acquisition (bounded probe, Chromium observer, screenshots)
redaction/         Pure redaction helpers
report/            Markdown and JSON report builders
shared/            Shared TypeScript types
extension/         Browser extension source
  background/      Service worker and evidence coordinator
  content/         Content bridge (Chrome-mediated probe execution)
  popup/           SNITCH button UI
scripts/           Build and test scripts
tests/             Unit tests
docs/              Additional project documentation
```

## Design Rules

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

## Release State

DEVSnitcher v2.0.0 is a working local extension build.

Validated:

- TypeScript compile: passing
- ESLint: passing
- Tests: passing
- Build: passing
- Manual browser proof: Chrome/Chromium flow validated on localhost
- Microsoft Edge compatibility: validated through Chromium extension flow

Current locked release:

```text
devsnitcher-v2.0.0
```

Release checkpoints:

```text
devsnitcher-v0.1-snitch-button
devsnitcher-v0.1-browser-proof
devsnitcher-v0.1.1-target-icon
devsnitcher-v2.0.0
```

## Icon

The DEVSnitcher icon is a dark navy square with a red target mark.

- dark navy square
- red target ring
- red center dot

The mark represents capture, evidence, and targeting the bug.

## Open Source Position

DEVSnitcher is open source under the MIT License.

Developers should be able to capture browser evidence without trusting a cloud service or buying into a platform.

The project should remain small, inspectable, and useful without vendor lock-in.

## Future Ideas

These are intentionally outside v2.x:

- Firefox support
- GitHub issue export
- Jira export
- Linear export
- HAR attachment
- performance capture
- Lighthouse summary
- React component tree
- Vue inspection
- Redux/Zustand snapshots
- console recording timeline
- multi-page session capture
- SHERLOCK export format

None of these should compromise the core promise:

```text
Press SNITCH.
Paste into AI.
```

## ARCHETRON Ecosystem Context

DEVSnitcher is intentionally standalone, but it belongs to the same evidence-first family of systems as ARCHETRON.

Its place is at the browser edge:

```text
browser failure
      │
      ▼
 DEVSnitcher
 capture + redact + package
      │
      ├──────────────► AI / issue / chat / human debugger
      │
      └──────────────► larger evidence workflows
                           │
                           ▼
                    SHERLOCK / ERIE
```

DEVSnitcher does not become the investigation engine or the reasoning engine. It captures the immediate evidence cleanly and makes it portable.

The surrounding ecosystem keeps those responsibilities separate:

- **DEVSnitcher** — local browser evidence capture and portable debugging reports.
- **SHERLOCK** — evidence reconstruction across larger project histories.
- **ERIE** — structured evidence, context, relationships, and provenance.
- **PEEP** — live execution observation.
- **ARCHERAT** — telemetry and operational observation.
- **ARCHE** — allocation of cognitive attention.
- **GATEHOUSE** — authority and governance boundaries.
- **CTRL TOWER** — human operator control.
- **ARCHESTRATOR** — software engineering execution management.
- **ARCHEMADA** — user-facing software engineering application.
- **NIRMATA** — persona creation for ARCHE.

The connection is architectural rather than mandatory coupling: capture, observation, evidence, reasoning, authority, and action remain distinguishable.

DEVSnitcher does not require SHERLOCK or any other ARCHETRON component to be useful.

---

## Evidence First. AI Second.

DEVSnitcher is local browser evidence capture, one SNITCH report, no backend, no telemetry, and no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
