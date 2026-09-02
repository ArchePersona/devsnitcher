# Testing DEVSnitcher

DEVSnitcher should be verified with automated checks and a manual browser proof.

The automated checks prove the code builds and the pure logic behaves.

The manual browser proof proves the actual extension flow works inside Chrome or Edge.

---

## Automated verification

Run from the repo root:

```powershell
npm run build
npm run typecheck
npm run lint
npm test
```

Do not hard-code a passing test count in documentation. The current suite is expected to complete with zero failures.

For the encrypted cache, focused verification should establish at minimum:

- plaintext evidence is not used as the persisted cache representation
- AES-GCM encryption/decryption round-trip succeeds
- separate writes use fresh IVs
- altered authenticated ciphertext or IV fails decryption
- a cache record bound to the wrong tab/page identity is rejected
- a stale URL record is rejected
- malformed cache-write payloads are rejected
- SNITCH can consume a valid encrypted cached record

For the DEVPEEPER Chrome-mediated bounded observation, focused verification should establish at minimum:

- the bounded probe returns plain serializable data with no `window.postMessage` transport
- a Chrome-mediated snapshot normalizes into `EnvironmentInfo`/`DomContext` (timestamp added)
- the observation envelope separates payload, acquisition mechanism and browser provenance
- absent browser identities (e.g. `documentId`) are not invented

For the DEVPEEPER Chromium observation foundation, focused verification should establish at minimum:

- the observer lifecycle (not running before start, running after start, stopped after stop)
- attachment targets only the bound active tab and enables the minimal `Page`, `Runtime` and `Network` domains
- instrumentation is accepted only for the active attachment tab, not other tabs
- browser-issued provenance (`tabId`, `frameId`, `loaderId`, `requestId`, `timestamp`) is preserved, and unrelated CDP methods are not elevated to observations
- Chrome-initiated detach stops the observer and clears stale observations
- a detach error does not break the caller

For DEVPEEPER-003 browser-observed console + runtime errors, focused verification should establish at minimum:

- `Network.enable` is added together with `Page.enable` and `Runtime.enable`
- supported `Runtime.consoleAPICalled` events normalize correctly (level mapping, bounded message formatting, stack)
- unsupported console event types are ignored
- `Runtime.exceptionThrown` normalizes without invented provenance and without synthesized `promise_rejection` classification
- events from the wrong tab are rejected
- console/error history is bounded (200 console, 50 errors) and cleared on detach
- no page-authored `window.postMessage` value can supply console/jsErrors (background assembles console/jsErrors only from the active-tab Chromium session)
- active-tab replacement does not mix buffered observations

Keep this coverage proportional. Do not build a large mock framework solely to exercise browser APIs that are better proven manually.

---

## Manual browser proof

Build the extension:

```powershell
cd D:\DEVSnitcher
npm run build
```

Start a local server:

```powershell
python -m http.server 8088
```

Open the test page:

```text
http://localhost:8088/test.html
```

Load the extension:

```text
chrome://extensions
Developer Mode → On
Load unpacked
Select D:\DEVSnitcher\dist
```

For Edge:

```text
edge://extensions
Developer Mode → On
Load unpacked
Select D:\DEVSnitcher\dist
```

---

## Proof checklist

Trigger the test buttons, allow the rolling cache to refresh, click **SNITCH**, then paste the clipboard output into a text file or AI chat.

The report should include:

| Checkpoint | Expected |
|---|---|
| Markdown report copied | Pass |
| URL captured | Pass |
| Page title captured | Pass |
| Browser captured | Pass |
| Platform captured | Pass |
| Viewport captured | Pass |
| Timestamp captured | Pass |
| Console warning captured | Pass |
| Console error captured | Pass |
| Failed 404 request captured | Pass |
| Failed 500 request captured | Pass |
| Unhandled exception captured | Pass |
| Promise rejection captured | Pass |
| DOM context captured | Pass |
| Summary counts generated | Pass |
| Obvious secrets redacted | Pass |
| No DEVSnitcher backend traffic | Pass |
| SNITCH works from encrypted rolling cache | Pass |

---

## Encrypted-cache proof

The browser-session cache is extension-owned and encrypted before evidence storage.

Verify the following in a development build:

1. Open the test page and generate console/network/runtime evidence.
2. Wait at least one rolling refresh interval.
3. Click **SNITCH** and confirm the pre-click evidence appears in the report.
4. Confirm the extension uses `chrome.storage.session` for the cache and that the evidence record is ciphertext plus required metadata rather than a plaintext `Evidence` object.
5. Confirm ordinary page JavaScript cannot read the cache or encryption key.
6. Navigate the tab to a different page and confirm the old per-tab cache record is cleared/rejected.
7. Close the tab and confirm its per-tab cache record is removed.

The cache key must not appear in page globals, DOM attributes, page messages, report output, or content-script state.

AES-GCM authentication failure should be treated as an unusable cache record, not as valid evidence.

---

## DEVPEEPER bounded-observation proof

Environment/DOM now comes from a Chrome-mediated bounded probe, not the page.

1. Open the test page and generate DOM/focus evidence.
2. Wait at least one rolling refresh interval so the probe repopulates the cache.
3. From page JavaScript, attempt to post a `window.postMessage` claiming a different environment/title/DOM; confirm there is no DEVSnitch `EVIDENCE_RESULT` protocol the page can publish through, and the value is ignored.
4. Click **SNITCH** and confirm the report's environment/title/DOM match the real page (the Chrome probe) rather than any forged values.
5. Confirm the bounded probe starts no listeners and the extension executes it through `chrome.scripting.executeScript` (visible in the background/content-script bundle).

This proves the bounded return path is Chrome-authenticated, not page-authored.

---

## DEVPEEPER Chromium observation foundation proof

This milestone establishes the active-tab Chromium/CDP attachment lifecycle. Because automated tests cannot drive a live `chrome.debugger` session in the repo test environment, they verify the lifecycle/provenance boundary against a narrow mocked transport; this manual proof exercises the real debugger surface.

1. Load the extension, open a normal tab on `http://localhost:8088/test.html`, and click **SNITCH** once so the background attaches the Chromium observer to the active tab.
2. Confirm the extension requests the `debugger` permission and attaches only to the active tab (inspect `chrome://extensions`, open the service worker, and observe `chrome.debugger.onEvent` registration / `Page.enable`).
3. Reload or navigate the tab and confirm the DEVPEEPER observer receives a `Page.frameNavigated` event and preserves browser provenance (`tabId`, `frameId`, `loaderId`).
4. Open Chrome DevTools for the attached tab (or close the tab) and confirm the observer reports not running after Chrome detaches it, with no stale observations presented as live.
5. Confirm attachment is active-tab only: other tabs/targets are not enumerated or attached.

This proves attachment, Chrome delivering instrumentation to the extension, DEVPEEPER associating it with the active-tab attachment, and provenance preservation. It is infrastructure proof only; console/error migration is verified in the next proof.

---

## DEVPEEPER browser-observed console + runtime errors proof

This proof exercises the live debugger surface for console and runtime-error observation against the same narrow-mock limitation noted above.

1. Load the extension and open a normal tab on `http://localhost:8088/test.html`; the background should attach the Chromium observer to the active tab on activation (no SNITCH needed), enabling `Page`, `Runtime` and `Network`.
2. From the page, call `console.log('hello')`, `console.error('boom')`, and `throw new Error('uncaught')` (or trigger an unhandled rejection).
3. Click **SNITCH** and confirm the report's Console section contains the browser-observed `hello`/`boom` entries and the JavaScript section contains the thrown error — and that these come from the active-tab Chromium session, not the page message.
4. From page JavaScript, attempt to post a `window.postMessage` whose `console`/`jsErrors` claim different values, then click **SNITCH**; confirm the report still uses the browser-observed values and no page-authored value is treated as evidence.
5. Switch to or open another tab and confirm a fresh active-tab attachment with no carried-over console/error history from the prior tab.

This proves browser-observed console/runtime evidence arrives through the active-tab Chromium session, is preserved with provenance, and cannot be replaced by raced page-authored messages.

---

## DEVPEEPER browser-observed network proof (DEVPEEPER-004)

This proof exercises the live debugger surface for the browser-observed network path against the same narrow-mock limitation noted above.

1. Load the extension and open a normal tab on `http://localhost:8088/test.html`; the background should attach the Chromium observer to the active tab on activation (no SNITCH needed), enabling the `Network` domain.
2. From the page, trigger a failing HTTP request (e.g. fetch a URL that returns `404`/`500`, and force a browser-level failure such as a connection-refused request) and confirm the report's Network section contains those failed requests with method, URL, status (or `0` for a browser-level failure), Chrome monotonic duration, and a bounded response preview.
3. Confirm successful 2xx/3xx requests do **not** appear in the report.
4. From page JavaScript, attempt to post a `window.postMessage` whose `network` claims a different set of failed requests, then click **SNITCH**; confirm the report still uses the browser-observed network entries and no page-authored value is treated as evidence.
5. Confirm the page-context network monkey-patch is gone: the background/content bundle no longer starts `startNetworkCollector`, and ordinary page `fetch`/`XHR` are no longer wrapped (inspect the content-script/background bundle).
6. Switch to or open another tab and confirm a fresh active-tab attachment with no carried-over network history from the prior tab.

This proves failed-network evidence now arrives browser-observed through the active-tab Chromium session, preserved with provenance, bounded, and cannot be replaced by page-authored messages.

---

## Trust-boundary regression proof

The page must not be able to invoke the privileged `SNITCH` flow through `window.postMessage` or through a tab-relayed runtime message.

From page JavaScript, attempting to post:

```js
window.postMessage({ type: 'SNITCH', screenshot: true }, '*');
```

must not:

- trigger privileged SNITCH execution
- trigger screenshot capture
- change the clipboard
- produce `SNITCH_RESULT`
- expose a screenshot data URL or generated report back to the page

The background service worker must also refuse `SNITCH` when the runtime sender has a tab. The normal popup button must continue to initiate `SNITCH` successfully.

This regression proof protects the privileged-action boundary between untrusted page/tab contexts and extension behavior.

---

## Evidence-authenticity limitation

Do **not** use successful encrypted-cache or SNITCH-boundary tests as proof that page evidence itself cannot be forged.

Environment, focused DOM and current selection are browser-mediated: acquired through `chrome.scripting.executeScript` and returned in Chrome's `InjectionResult`, so a page calling `window.postMessage` cannot forge those bounded observations. Chrome authenticates the transport path; it does not make the underlying page-controlled DOM/focus state truthful.

Console, runtime-error and network evidence all travel browser-observed through the active-tab Chromium session; there is no page-facing `window.postMessage` `COLLECT_EVIDENCE`/`EVIDENCE_RESULT` evidence bus. A hostile page script cannot fabricate console, network or error evidence, because DEVSnitcher injects no MAIN-world collector and no authoritative evidence originates from a page-authored message.

The encrypted cache begins protecting evidence only after that acceptance point.

---

## Known browser constraints

### Local file pages

`file://` pages may require extra browser permission.

Preferred test path:

```text
http://localhost:8088/test.html
```

Alternative:

```text
Extension details → Allow access to file URLs
```

### Browser-internal pages

DEVSnitcher should not inspect browser-internal pages such as:

```text
chrome://extensions
edge://extensions
chrome-extension://...
about:blank
```

The extension should show a clear error instead.

---

## What a useful report looks like

A useful report should let an AI immediately see:

- What page was open
- What browser was used
- What the user clicked or focused
- What the console reported
- Which network requests failed
- Which runtime errors happened
- Whether there were promise rejections
- A short summary of evidence counts

If the AI still has to ask for basic DevTools evidence, the report is not good enough yet.

---

## Release checklist

Before tagging a release:

```powershell
npm run build
npm run typecheck
npm run lint
npm test
```

Then complete manual browser proof in at least one Chromium browser, including encrypted-cache and privileged-action regression checks.

Recommended release evidence note:

```md
# DEVSnitcher Browser Proof

Version: x.y.z
Browser: Chrome or Edge
Page: http://localhost:8088/test.html
Result: pass/fail

Checks:
- Environment captured
- Console captured
- Network captured
- JavaScript errors captured
- DOM context captured
- Redaction checked
- Encrypted rolling cache verified
- Navigation clears/rejects stale cache
- Clipboard output verified
- Page-originated and tab-relayed SNITCH blocked
- Page-evidence authenticity limitation acknowledged separately
```

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, encrypted browser-session cache, one user-triggered SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
