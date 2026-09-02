# Changelog

All notable changes to DEVSnitcher will be documented here.

---

## 2.0.0 — Browser-Observed Evidence

### Changed

- Replaced the page-authored evidence flow with browser-mediated observation on the active tab.
- Console, runtime errors and failed network requests are now browser-observed via a Chromium/CDP observer (`chrome.debugger`) enabled on the active tab only (`Page`, `Runtime`, `Network` domains), with browser-issued provenance preserved.
- Environment, focused DOM and current selection are now browser-returned through a bounded `chrome.scripting.executeScript` probe; Chrome returns the result in its own `InjectionResult`.
- Removed the legacy `window.postMessage` `COLLECT_EVIDENCE` / `EVIDENCE_RESULT` page-evidence bus, the MAIN-world evidence collector, and the page-context network monkey-patch. No authoritative evidence originates from a page-authored message.
- Active-tab scope is deliberate: the observer follows the currently active supported tab and never monitors whole-browser targets.
- Network retention is bounded and failure-focused: only HTTP status `>= 400` or browser-reported failures (status `0`) are kept, response bodies fetched only for retained HTTP failures and truncated to 1000 characters, bounded at 100 entries per active-tab session.

### Documentation

- Updated README, architecture, privacy, testing, and security documentation to describe the 2.0 browser-observed evidence model and trust boundaries.
- Aligned the documentation with the v2.0.0 release line.

### Locked release

```text
devsnitcher-v2.0.0
```

Press SNITCH. Paste into AI.

---

## 0.1.1 — Target Icon + Stable Evidence Flow

### Changed

- Stabilized the evidence flow with a PING/PONG handshake between the background service worker and the content script.
- Added a lazy content-script availability check before evidence collection, replacing broad tab-wide eager injection.
- Tightened browser page matching to ordinary HTTP and HTTPS pages.
- Simplified the content-script return flow to a single promise-based response.
- Added the DEVSnitcher target icon (dark navy square + red target ring + red center dot) to the extension and the repository.
- Generated extension icons locally with `scripts/gen-icons.cjs` during the build.
- Fixed the build so stale icon files cannot remain in `dist/`.
- Removed `PAGE_SCRIPT_READY` from the shared message types in favor of the PING/PONG handshake.
- Fixed redaction so stack traces have URLs redacted before token redaction.
- Fixed redaction so request response previews and general text go through URL redaction.
- Fixed screenshot dimensions to use the real image width and height.
- Hardened the DOM selector builder against false and invalid indexes.
- Fixed the console stack filter to match `console.warn` and `console.error` frames.
- Added `typeof window === 'undefined'` guards to the JavaScript and network collectors for non-browser environments.
- Added automated tests for the v0.1.1 fixes. The suite now has 24 tests, all passing.

### Documentation

- Added complete README.
- Added MIT license file.
- Added contribution guide.
- Added security policy.
- Added architecture documentation.
- Added manual testing guide.
- Added privacy notes.
- Aligned the documentation with the v0.1.1 release line.

### Locked release

```text
devsnitcher-v0.1.1-target-icon
```

Press SNITCH. Paste into AI.

---

## 0.1.0

### Added

- Initial DEVSnitcher browser extension.
- One-button SNITCH popup.
- AI-ready Markdown report generation.
- Environment capture.
- Console evidence capture.
- Failed network request capture.
- JavaScript error and promise rejection capture.
- DOM context capture.
- Best-effort redaction modules.
- Clipboard report output.
- Local test page.

### Tags

```text
devsnitcher-v0.1-snitch-button
devsnitcher-v0.1-browser-proof
```

For the broader evidence-first project, see SHERLOCK: https://sherlock-xprize.web.app
