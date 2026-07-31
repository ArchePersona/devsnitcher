import type { ReportInput, ConsoleEntry, NetworkEntry, JsErrorEntry } from '../shared/types';

function fmtTime(ms: number): string {
  return new Date(ms).toISOString();
}

function formatConsoleLine(entry: ConsoleEntry): string {
  const ts = fmtTime(entry.timestamp);
  const prefix = entry.level.toUpperCase();
  const base = `[${ts}] ${prefix} ${entry.message}`;
  return entry.stack ? `${base}\n${entry.stack}` : base;
}

function formatNetworkLine(entry: NetworkEntry): string {
  const status = entry.status === 0 ? 'FAILED (no response)' : String(entry.status);
  const dur = `${entry.duration}ms`;
  const lines = [
    `${entry.method} ${entry.url} → ${status} (${dur})`,
  ];
  if (entry.responsePreview) {
    lines.push(`Preview: ${entry.responsePreview}`);
  }
  const headerKeys = Object.keys(entry.requestHeaders);
  if (headerKeys.length > 0) {
    const hs = headerKeys.map((k) => `  ${k}: ${entry.requestHeaders[k]}`).join('\n');
    lines.push(`Request headers:\n${hs}`);
  }
  return lines.join('\n');
}

function formatJsErrorLine(entry: JsErrorEntry): string {
  const loc =
    entry.filename
      ? ` @ ${entry.filename}:${entry.lineno ?? 0}:${entry.colno ?? 0}`
      : '';
  const kind =
    entry.type === 'promise_rejection' ? 'Unhandled Promise rejection' : 'Unhandled exception';
  return `${kind}: ${entry.message}${loc}\n${entry.stack}`;
}

function countFailedNetwork(entries: NetworkEntry[]): number {
  return entries.filter((e) => e.status === 0 || e.status >= 400).length;
}

export function buildMarkdownReport(input: ReportInput): string {
  const { evidence, userNotes } = input;
  const env = evidence.environment;

  const sections: string[] = [];
  sections.push('# DEVSNITCHER REPORT');

  sections.push('## User Description');
  sections.push(userNotes.trim() ? userNotes.trim() : '_(not provided)_');

  sections.push('## Environment');
  sections.push([
    `- URL: ${env.url}`,
    `- Page title: ${env.title}`,
    `- Browser: ${env.browser}`,
    `- Platform: ${env.platform}`,
    `- Viewport: ${env.viewport.width}x${env.viewport.height}`,
    `- Timestamp: ${fmtTime(env.timestamp)}`,
  ].join('\n'));

  sections.push('## Console');
  if (evidence.console.length === 0) {
    sections.push('_(no console entries)_');
  } else {
    sections.push(evidence.console.map(formatConsoleLine).join('\n\n'));
  }

  sections.push('## Network');
  if (evidence.network.length === 0) {
    sections.push('_(no failed requests)_');
  } else {
    sections.push(evidence.network.map(formatNetworkLine).join('\n\n'));
  }

  sections.push('## JavaScript');
  if (evidence.jsErrors.length === 0) {
    sections.push('_(no unhandled errors)_');
  } else {
    sections.push(evidence.jsErrors.map(formatJsErrorLine).join('\n\n'));
  }

  sections.push('## DOM Context');
  if (!evidence.dom) {
    sections.push('_(no element selected)_');
  } else {
    sections.push([
      `- Selector: ${evidence.dom.selector}`,
      `- Tag: ${evidence.dom.tagName}`,
      `- Class: ${evidence.dom.className || '_(none)_'}`,
      `- Focused: ${evidence.dom.isFocused ? 'yes' : 'no'}`,
      '',
      '```html',
      evidence.dom.html,
      '```',
    ].join('\n'));
  }

  sections.push('## Screenshot');
  sections.push(evidence.screenshot ? 'Attached' : '_(not captured)_');

  sections.push('## Summary');
  const consoleErrors = evidence.console.filter((e) => e.level === 'error').length;
  const consoleWarns = evidence.console.filter((e) => e.level === 'warn').length;
  const failedReqs = countFailedNetwork(evidence.network);
  const summary: string[] = [];
  if (consoleErrors > 0) summary.push(`${consoleErrors} console error${consoleErrors > 1 ? 's' : ''}`);
  if (consoleWarns > 0) summary.push(`${consoleWarns} console warning${consoleWarns > 1 ? 's' : ''}`);
  summary.push(`${failedReqs} failed API request${failedReqs !== 1 ? 's' : ''}`);
  summary.push(`${evidence.jsErrors.length} unhandled JS error${evidence.jsErrors.length !== 1 ? 's' : ''}`);
  sections.push(summary.join('\n'));

  return sections.join('\n\n---\n\n') + '\n';
}
