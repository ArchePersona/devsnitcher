# DEVSnitcher

**Press SNITCH. Paste into AI.**

A browser extension that captures page evidence (console logs, failed network requests, JS errors, DOM context, environment, screenshot) and produces a clean AI-ready report on the clipboard.

## Architecture

```
collectors/       → Evidence collectors (chrome-agnostic, page-world logic)
redaction/        → Sensitive data redaction (headers, cookies, tokens, URLs)
report/           → Report builders (markdown, JSON) + clipboard writer
extension/
  content/        → Injected content script + page-script bridge
  background/     → Service worker (coordinates, screenshot, report assembly)
  popup/          → SNITCH button UI
```

## Commands

```bash
npm run build       # Bundle → dist/
npm run dev         # Watch mode
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm test            # Run 18 automated tests (collectors, redaction, report)
```

## Loading in Chrome

1. Build: `npm run build`
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `dist/` directory

No backend. No accounts. No telemetry. Everything stays local. Clipboard only.

## Design Rules

- **Evidence first, AI second.** Do not diagnose. Just capture.
- **Will this help an AI diagnose the problem?** If no, don't collect it.
- **Stay tiny.** Small modules, no god files. Feature creep is the enemy.