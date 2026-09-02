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
- no debugger attaches before SNITCH (a fresh manager is idle with zero attach calls; tab activation alone never attaches)
- attachment targets only the selected session tab and enables the minimal `Page`, `Runtime` and `Network` domains, and does not follow later tab activation
- instrumentation is accepted only for the session attachment tab, not other tabs
- browser-issued provenance (`tabId`, `frameId`, `loaderId`, `requestId`, `timestamp`) is preserved, and unrelated CDP methods are not elevated to observations
- Chrome-initiated detach stops the observer and clears stale observations
- a detach error does not break the caller

For DEVPEEPER-003 browser-observed console + runtime errors, focused verification should establish at minimum:

- `Runtime.enable` is added alongside the existing `Page.enable`, while `Network.enable` remains absent for DEVPEEPER-003.
- supported `Runtime.consoleAPICalled` events normalize correctly (level mapping, bounded message formatting, stack)
- unsupported console event types are ignored
- `Runtime.exceptionThrown` normalizes without invented provenance and without synthesized `promise_rejection` classification
- events from the wrong tab are rejected
- console/error history is bounded (200 console, 50 errors) and cleared on detach
- no page-authored `window.postMessage` value can supply console/jsErrors (background assembles console/jsErrors only from the SNITCH-session Chromium observer)
- a surface with no entries completes once the harvest window elapses (empty is legitimate and complete), ending the session; a session never waits indefinitely for an error

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

Trigger the test buttons, click **SNITCH**, confirm the session completes and the report is held in the private buffer, then press **COPY SNITCHSHOT** and paste the clipboard contents (e.g. into Notepad with `Ctrl+V`).

The report should include:

| Checkpoint | Expected |
|---|---|
| Markdown report held in private buffer | Pass |
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
| Debugger attaches only during a live SNITCH session, and only to the selected tab | Pass |
| COPY SNITCHSHOT writes the report to the system clipboard and clears the buffer | Pass |
| CANCEL detaches and never resurrects after tab switching | Pass |

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

## DEVPEEPER SNITCH-session observation foundation proof

This milestone establishes the single-tab SNITCH-session Chromium/CDP attachment lifecycle. Because automated tests cannot drive a live `chrome.debugger` session in the repo test environment, they verify the lifecycle/provenance boundary against a narrow mocked transport; this manual proof exercises the real debugger surface.

1. Load the extension and open/activate a supported normal tab on `http://localhost:8088/test.html` **without** pressing SNITCH. Confirm no debugger attaches: open the service worker and verify there is no `chrome.debugger.attach`, `Page.enable`, or `Runtime.enable` — activation alone never attaches the observer.
2. Now click **SNITCH**. Confirm the extension requests the `debugger` permission and attaches only to the selected tab (inspect `chrome://extensions`, open the service worker, and observe `chrome.debugger.onEvent` registration / `Page.enable`).
3. Switch to another tab while the session is live. Confirm the session does not move: it remains bound to the originally selected tab and never attaches to the newly activated tab.
4. Reload or navigate the session tab and confirm the DEVPEEPER observer receives a `Page.frameNavigated` event and preserves browser provenance (`tabId`, `frameId`, `loaderId`).
5. Open Chrome DevTools for the attached tab (or close the tab) and confirm the observer reports not running after Chrome detaches it, with no stale observations presented as live.
6. Confirm attachment is session-tab only: other tabs/targets are not enumerated or attached.

This proves attachment only on SNITCH, single-tab immutability, and provenance preservation. It is infrastructure proof only; console/error migration is verified in the next proof.

---

## DEVPEEPER browser-observed console + runtime errors proof

This proof exercises the live debugger surface for console and runtime-error observation against the same narrow-mock limitation noted above.

1. Load the extension, open a normal tab on `http://localhost:8088/test.html`, and click **SNITCH**; the background attaches the Chromium observer to the selected tab, enabling `Page`, `Runtime` and `Network`.
2. From the page, call `console.log('hello')`, `console.error('boom')`, and `throw new Error('uncaught')` (or trigger an unhandled rejection).
3. Confirm the session completes (evidence gathered, debugger detached) and the report's Console section contains the browser-observed `hello`/`boom` entries and the JavaScript section contains the thrown error — and that these come from the SNITCH-session Chromium observer, not the page message.
4. From page JavaScript, attempt to post a `window.postMessage` whose `console`/`jsErrors` claim different values, then click **SNITCH**; confirm the report still uses the browser-observed values and no page-authored value is treated as evidence.
5. Click **CANCEL** mid-session and switch to another tab; confirm the session is terminal — it does not resume or move to the newly activated tab, and no debugger remains attached.

This proves browser-observed console/runtime evidence arrives through the SNITCH-session Chromium observer, is preserved with provenance, and cannot be replaced by raced page-authored messages.

---

## DEVPEEPER browser-observed network proof (DEVPEEPER-004)

This proof exercises the live debugger surface for the browser-observed network path against the same narrow-mock limitation noted above.

1. Load the extension, open a normal tab on `http://localhost:8088/test.html`, and click **SNITCH**; the background attaches the Chromium observer to the selected tab, enabling the `Network` domain.
2. From the page, trigger a failing HTTP request (e.g. fetch a URL that returns `404`/`500`, and force a browser-level failure such as a connection-refused request) and confirm the report's Network section contains those failed requests with method, URL, status (or `0` for a browser-level failure), Chrome monotonic duration, and a bounded response preview.
3. Confirm successful 2xx/3xx requests do **not** appear in the report.
4. From page JavaScript, attempt to post a `window.postMessage` whose `network` claims a different set of failed requests, then click **SNITCH**; confirm the report still uses the browser-observed network entries and no page-authored value is treated as evidence.
5. Confirm the page-context network monkey-patch is gone: the background/content bundle no longer starts `startNetworkCollector`, and ordinary page `fetch`/`XHR` are no longer wrapped (inspect the content-script/background bundle).
6. Confirm that if a session produces no network failures, it still completes after the harvest window — the session detaches and the report is produced rather than waiting indefinitely.

This proves failed-network evidence now arrives browser-observed through the SNITCH-session Chromium observer, preserved with provenance, bounded, and cannot be replaced by page-authored messages.

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
- read or clear the private SNITCHSHOT buffer
- command a COPY SNITCHSHOT clipboard write
- produce `SNITCH_RESULT`
- expose a screenshot data URL or generated report back to the page

The background service worker must also refuse `SNITCH`, `GET_SNITCHSHOT`, `CLIPBOARD_RELEASED`, `GET_STATUS` and `CANCEL_SNITCH` when the runtime sender has a tab. The normal popup buttons must continue to initiate `SNITCH`, `CANCEL` and `COPY SNITCHSHOT` successfully.

This regression proof protects the privileged-action boundary between untrusted page/tab contexts and extension behavior.

---

## Evidence-authenticity limitation

Do **not** use successful encrypted-cache or SNITCH-boundary tests as proof that page evidence itself cannot be forged.

Environment, focused DOM and current selection are browser-mediated: acquired through `chrome.scripting.executeScript` and returned in Chrome's `InjectionResult`, so a page calling `window.postMessage` cannot forge those bounded observations. Chrome authenticates the transport path; it does not make the underlying page-controlled DOM/focus state truthful.

Console, runtime-error and network evidence all travel browser-observed through the SNITCH-session Chromium observer; there is no page-facing `window.postMessage` `COLLECT_EVIDENCE`/`EVIDENCE_RESULT` evidence bus, so a page cannot forge or substitute DEVSnitch console/runtime/network evidence through a page-authored evidence protocol. Those observations enter DEVSnitch only through the SNITCH-session Chromium/CDP path. However, the page can still deliberately cause console output, runtime failures, or network activity that Chromium legitimately observes. Browser-observed provenance proves the acquisition path, not the semantic truth or innocence of the page behavior.

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
- No debugger attach before SNITCH (activation alone attaches nothing)
- SNITCH attaches only the selected tab and does not follow tab activation
- Evidence completion detaches the debugger and produces the report
- CANCEL detaches and never resurrects after tab switching
- COPY SNITCHSHOT writes to the system clipboard and clears the buffer
- Second SNITCH refused while a SNITCHSHOT is pending
- Failed clipboard write preserves the pending SNITCHSHOT
- Successful clipboard write re-enables SNITCH
- Page-originated and tab-relayed SNITCH / GET_SNITCHSHOT / CLIPBOARD_RELEASED blocked
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
