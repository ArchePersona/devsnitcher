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

Expected result:

```text
Build: dist/ generated
TypeScript: 0 errors
ESLint: 0 errors
Tests: 24/24 passing
```

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

Trigger the test buttons, click **SNITCH**, then paste the clipboard output into a text file or AI chat.

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

---

## Trust-boundary regression proof

The page must not be able to invoke the privileged `SNITCH` flow through `window.postMessage`.

From page JavaScript, attempting to post a message such as:

```js
window.postMessage({ type: 'SNITCH', screenshot: true }, '*');
```

must not:

- trigger evidence capture through the background service worker
- trigger screenshot capture
- produce `SNITCH_RESULT`
- expose a screenshot data URL or generated report back to the page

The normal popup button must continue to initiate `SNITCH` successfully.

This regression proof protects the boundary between untrusted page JavaScript and privileged extension behavior.

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

Then complete manual browser proof in at least one Chromium browser, including the trust-boundary regression proof above.

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
- Clipboard output verified
- Page-originated SNITCH blocked
```

---

## Evidence First. AI Second.

DEVSnitcher is intentionally standalone: local browser evidence capture, one SNITCH report, no backend, no telemetry, no AI calls.

For deeper evidence reconstruction, the same principle continues in **SHERLOCK**: files, conversations, timelines, source artifacts, provenance, and investigation reports.

DEVSnitcher does not require SHERLOCK.

If DEVSnitcher helps you, please consider supporting the bootstrapped founder by checking out SHERLOCK:

```text
https://sherlock-xprize.web.app
```
