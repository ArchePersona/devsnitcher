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

The current page-facing evidence transport uses `window.postMessage` for `COLLECT_EVIDENCE` / `EVIDENCE_RESULT`. A hostile page script may attempt to fabricate an `EVIDENCE_RESULT` before the content bridge accepts it.

The encrypted cache begins protecting evidence only after that acceptance point.

Treat page-evidence ingress authenticity as separate security work.

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
