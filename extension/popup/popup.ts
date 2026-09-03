import type { SnitchMessage } from '../../shared/types';
import { writeTextViaDomCopy, fingerprint } from '../../report/clipboard';
import { ctaConfig, type PopupCtaState } from './cta-config';

const STATUS_POLL_MS = 500;

// Pre-fetched report content, held in popup memory so COPY can write to the OS
// clipboard SYNCHRONOUSLY within the click gesture. The private buffer in the
// background remains authoritative and is only cleared on CLIPBOARD_RELEASED.
let cachedReport: string | null = null;

const CLIPBOARD_BUILD = 'a769e19+diag';

document.addEventListener('DOMContentLoaded', () => {
  const snitchBtn = document.getElementById('snitch') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;
  const copyBtn = document.getElementById('copy') as HTMLButtonElement;
  const notes = document.getElementById('notes') as HTMLTextAreaElement;
  const screenshotCb = document.getElementById('screenshot') as HTMLInputElement;
  const field = document.querySelector('.field') as HTMLElement | null;
  const screenshotRow = document.querySelector('.checkbox') as HTMLElement | null;
  const snitchStateEl = document.getElementById('snitch-state') as HTMLSpanElement;
  const cancelStateEl = document.getElementById('cancel-state') as HTMLSpanElement;
  const copyStateEl = document.getElementById('copy-state') as HTMLSpanElement;
  const resultEl = document.getElementById('result') as HTMLParagraphElement;

  let pollTimer: number | null = null;
  // The authoritative lifecycle (background states + the popup-local COPYING).
  let currentState: PopupCtaState = 'idle';

  async function send(msg: SnitchMessage): Promise<SnitchMessage | undefined> {
    return (await chrome.runtime.sendMessage(msg)) as SnitchMessage | undefined;
  }

  /**
   * The single deterministic projection of the lifecycle onto the three CTAs.
   * All three remain rendered; the state decides which is enabled and what each
   * contextual label says. This is the only place CTA configuration is derived,
   * so the popup can never present contradictory active actions.
   */
  function render(state: PopupCtaState): void {
    currentState = state;
    const cfg = ctaConfig(state);

    snitchBtn.disabled = !cfg.snitchEnabled;
    cancelBtn.disabled = !cfg.cancelEnabled;
    copyBtn.disabled = !cfg.copyEnabled;

    snitchStateEl.textContent = cfg.snitchLabel;
    cancelStateEl.textContent = cfg.cancelLabel;
    copyStateEl.textContent = cfg.copyLabel;

    if (field) field.hidden = !cfg.inputsEnabled;
    if (screenshotRow) screenshotRow.hidden = !cfg.inputsEnabled;
    notes.disabled = !cfg.inputsEnabled;
    screenshotCb.disabled = !cfg.inputsEnabled;

    // Drive the helper message from the same projection; no divergent UI bits.
    if (state === 'observing') {
      resultEl.textContent = 'Collecting browser evidence on the selected tab…';
      resultEl.className = 'result';
    } else if (state === 'snitchshot_pending') {
      resultEl.textContent = 'SNITCHSHOT ready. Copy it, then Ctrl+V anywhere.';
      resultEl.className = 'result';
    } else if (state === 'copying') {
      // copy button sub-label shows "Copying…"; keep a neutral helper line.
      resultEl.textContent = '';
      resultEl.className = 'result';
    } else {
      resultEl.textContent = '';
      resultEl.className = 'result';
    }
  }

  async function refreshStatus(fromPoll = false): Promise<void> {
    // Ignore a stale poll if a local COPYING transition is in progress — the
    // background, which may not know about COPYING yet, must not clobber it.
    if (currentState === 'copying') return;

    const response = await send({ type: 'GET_STATUS' } satisfies SnitchMessage);
    if (!response) return;

    if (response.type === 'STATUS_RESULT') {
      render(response.state);
      if (response.state === 'observing') {
        schedulePoll();
      } else if (response.state === 'snitchshot_pending') {
        stopPoll();
        // Pre-fetch the report ahead of the gesture so the COPY click can run
        // execCommand('copy') synchronously within the activation window
        // (awaiting GET_SNITCHSHOT mid-gesture forfeits it).
        void fetchReportForCache();
      } else {
        // idle (or unknown): stop polling and drop any stale cached report.
        stopPoll();
        cachedReport = null;
        if (fromPoll) {
          resultEl.textContent = '';
          resultEl.className = 'result';
        }
      }
    } else if (response.type === 'EVIDENCE_ERROR') {
      stopPoll();
      cachedReport = null;
      render('idle');
      resultEl.textContent = response.error;
      resultEl.className = 'result err';
    }
  }

  function schedulePoll(): void {
    if (pollTimer != null) return;
    pollTimer = window.setInterval(() => void refreshStatus(true), STATUS_POLL_MS);
  }

  function stopPoll(): void {
    if (pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showError(message: string): void {
    resultEl.textContent = message;
    resultEl.className = 'result err';
  }

  function logDiagnostic(label: string, text: string): void {
    console.info(`[DEVSnitcher:${CLIPBOARD_BUILD}] ${label} ${fingerprint(text)}`);
  }

  // Fetch the pending report into popup memory. Runs off the gesture path (from
  // status polling / initial render) so the COPY click never awaits a
  // cross-process message before performing the synchronous OS clipboard write.
  async function fetchReportForCache(): Promise<void> {
    try {
      const content = await send({ type: 'GET_SNITCHSHOT' } satisfies SnitchMessage);
      if (!content) return;
      if (content.type !== 'SNITCHSHOT_CONTENT') return;
      cachedReport = content.report;
      logDiagnostic('buffer->popup:', content.report);
    } catch (err) {
      logDiagnostic('buffer->popup ERROR:', String(err));
    }
  }

  snitchBtn.addEventListener('click', async () => {
    snitchBtn.disabled = true;
    resultEl.textContent = 'Starting…';
    resultEl.className = 'result';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SNITCH',
        userNotes: notes.value.trim(),
        screenshot: screenshotCb.checked,
      } satisfies SnitchMessage);

      if (!response) throw new Error('No response from background');

      if (response.type === 'SNITCH_ERROR') {
        showError(response.error);
      } else if (response.type === 'SNITCH_ACCEPTED') {
        // SNITCH accepted; the project has entered OBSERVING. Let status drive UI.
      } else {
        showError('Unexpected response from background.');
      }
      await refreshStatus();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unknown error');
      await refreshStatus();
    } finally {
      snitchBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    resultEl.textContent = 'Cancelling…';
    resultEl.className = 'result';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CANCEL_SNITCH',
      } satisfies SnitchMessage);
      if (!response) throw new Error('No response from background');
      if (response.type === 'EVIDENCE_ERROR') {
        showError(response.error);
      } else {
        stopPoll();
        cachedReport = null;
        // Cancel returns authoritative state to IDLE; the backend confirms it.
        await refreshStatus();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unknown error');
      await refreshStatus();
    } finally {
      cancelBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    // Popup-local COPYING transition. No other CTA is actionable here, and the
    // button shows progress until the release is confirmed.
    render('copying');

    try {
      // Use the report pre-fetched into popup memory when the session completed.
      // The OS clipboard write (execCommand('copy')) MUST run synchronously,
      // directly inside this click gesture — awaiting GET_SNITCHSHOT here would
      // forfeit the transient user activation Chrome requires, so the write
      // would silently never reach the Windows clipboard.
      let report = cachedReport;
      if (!report) {
        // Degraded fallback: report not pre-fetched yet. Reading it now is best
        // effort and may lose the activation window; normal flow avoids it.
        const content = await send({ type: 'GET_SNITCHSHOT' } satisfies SnitchMessage);
        if (!content) throw new Error('No response from background');
        if (content.type !== 'SNITCHSHOT_CONTENT') {
          throw new Error(
            content.type === 'EVIDENCE_ERROR' ? content.error : 'Failed to read SNITCHSHOT',
          );
        }
        report = content.report;
        cachedReport = report;
      }

      logDiagnostic('popup->copy:', report);

      // Synchronous OS write within the gesture; only a confirmed execCommand
      // result authorizes release.
      writeTextViaDomCopy(report);

      // Only after the clipboard write succeeds does the private buffer clear.
      // A confirmed clear is required before returning to IDLE; the report must
      // not be reported as released if the buffer is still authoritative.
      const cleared = await send({
        type: 'CLIPBOARD_RELEASED',
      } satisfies SnitchMessage);
      if (cleared?.type === 'EVIDENCE_ERROR') {
        throw new Error(cleared.error);
      }
      if (cleared?.type !== 'CLIPBOARD_CLEARED') {
        throw new Error('Could not confirm the SNITCHSHOT was released.');
      }

      cachedReport = null;
      // Release confirmed: return to authoritative IDLE.
      await refreshStatus();
      resultEl.textContent = 'Report on clipboard. Now press Ctrl+V anywhere.';
      resultEl.className = 'result ok';
      // A short confirmation may remain visible without creating a durable state.
      snitchStateEl.textContent = 'Copied ✓';
    } catch (err) {
      // Buffer is retained; stay in the authoritative pending state so COPY can
      // be retried. The background still reports snitchshot_pending.
      await refreshStatus();
      showError(err instanceof Error ? err.message : 'Copy failed');
    }
  });

  void refreshStatus();
});