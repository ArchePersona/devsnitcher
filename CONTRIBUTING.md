# Contributing to DEVSnitcher

DEVSnitcher is intentionally small.

The product is not a platform. It is a browser extension with one core action:

```text
Press SNITCH. Paste into AI.
```

Contributions should protect that simplicity.

---

## Project principles

- Evidence first. AI second.
- Local by default.
- No account required.
- No backend required.
- No telemetry by default.
- No AI vendor lock-in.
- Reports must be readable by humans and useful to AI.
- Prefer small modules over large files.
- Prefer deterministic output over clever behavior.

---

## Good first contributions

Good areas for contribution include:

- Redaction improvements
- Report formatting cleanup
- Browser compatibility fixes
- Popup accessibility improvements
- Better test coverage
- Documentation improvements
- Clearer error messages
- Collector bug fixes

---

## Contributions to avoid during v0.x

Please avoid changes that turn DEVSnitcher into a large platform before the core extension is mature.

Out of scope for now:

- User accounts
- Cloud sync
- Dashboards
- Hosted storage
- Built-in AI diagnosis
- Long-running monitoring
- Vendor-specific AI chat integrations
- Analytics or telemetry by default
- Large framework migrations

These ideas may be useful later, but they should not complicate the first open-source release line.

---

## Local setup

```powershell
git clone https://github.com/ArchePersona/devsnitcher.git
cd DEVSnitcher
npm install
```

Run verification:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Load the built extension:

```text
Chrome or Edge extensions page
Developer Mode → On
Load unpacked
Select dist/
```

---

## Pull request expectations

Before opening a pull request, please run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

A good pull request should include:

- A clear description of the problem
- A short summary of the change
- Any manual browser testing performed
- Screenshots only when UI changed
- Tests when logic changed

---

## Report format changes

Be careful when changing report output.

The report is the product. It should stay:

- Easy to paste
- Easy to skim
- Easy for AI to parse
- Free of avoidable noise
- Clear about what was captured
- Clear about what was not captured

---

## Redaction changes

Redaction is best effort and should be conservative.

When adding redaction rules, include tests when possible.

Do not assume redaction is perfect. The README should continue to tell users to review reports before pasting them into third-party tools.

---

## Code style

Keep code simple and direct.

Avoid large all-purpose files. Prefer focused modules:

```text
collectors/
redaction/
report/
extension/background/
extension/content/
extension/popup/
shared/
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

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
