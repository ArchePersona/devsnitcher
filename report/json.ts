import type { ReportInput, Evidence } from '../shared/types';

export function buildJsonReport(input: ReportInput): string {
  const { evidence, userNotes } = input;
  const payload = {
    schema: 'devsnitcher/v1',
    userDescription: userNotes.trim(),
    evidence,
    summary: buildSummary(evidence),
  };
  return JSON.stringify(payload, null, 2);
}

function buildSummary(evidence: Evidence) {
  return {
    consoleErrors: evidence.console.filter((e) => e.level === 'error').length,
    consoleWarnings: evidence.console.filter((e) => e.level === 'warn').length,
    failedRequests: evidence.network.filter(
      (e) => e.status === 0 || e.status >= 400,
    ).length,
    unhandledErrors: evidence.jsErrors.length,
    hasDomContext: evidence.dom !== null,
    hasScreenshot: evidence.screenshot !== null,
  };
}
