import { fingerprint, writeTextViaDomCopy } from '../../report/clipboard';

export type ReleaseSenderResult = { ok: true } | { ok: false; error: string };

/**
 * Sends the CLIPBOARD_RELEASED confirmation to the background and maps the
 * response to a typed result. The response must be CLIPBOARD_CLEARED (the
 * background only sends it after verifying the private buffer actually
 * cleared); anything else — including EVIDENCE_ERROR — is a failed release.
 */
async function sendReleased(
  send: () => Promise<{ type: string; error?: string } | undefined>,
): Promise<ReleaseSenderResult> {
  const response = await send();
  if (response?.type === 'CLIPBOARD_CLEARED') return { ok: true };
  return { ok: false, error: response?.error ?? 'Could not confirm the SNITCHSHOT was released.' };
}

/**
 * Coordinates the COPY SNITCHSHOT release inside the explicit user gesture.
 *
 * Control flow:
 *   1. write the report to the OS clipboard via the popup DOM copy path
 *      (throws on failure => the SNITCHSHOT is retained and stays pending);
 *   2. only after the write succeeds, request the background release
 *      (CLIPBOARD_RELEASED);
 *   3. 'released' only when the background confirms the private buffer was
 *      actually cleared; 'kept' otherwise (buffer stays authoritative and the
 *      UI returns to SNITCHSHOT_PENDING).
 *
 * A failed or unconfirmed write NEVER releases the private buffer.
 */
export async function releaseReport(report: string, send: () => Promise<ReleaseSenderResult>): Promise<'released' | 'kept'> {
  // Boundary F -> G/H — the exact cached report is what reaches the clipboard
  // write mechanism; the fingerprint must match A/B/C/D/E.
  console.log(`[popup] copy-request ${fingerprint(report)}`);
  writeTextViaDomCopy(report);
  // Boundary I — only a confirmed write authorizes requesting release.
  console.log('[popup] release-request');
  const result = await send();
  if (!result.ok) {
    console.log(`[popup] release-kept: ${result.error}`);
    return 'kept';
  }
  console.log('[popup] released');
  return 'released';
}

export { sendReleased };