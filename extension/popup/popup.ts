import type { SnitchMessage, SnitchUiState } from '../../shared/types';
import { writeTextViaDomCopy } from '../../report/clipboard';
import { fingerprint } from '../../report/clipboard';

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
  const field = document.querySelector('.field') as HTMLElement;
  const screenshotRow = document.querySelector('.checkbox') as HTMLElement;
  const stateEl = document.getElementById('state') as HTMLSpanElement;
  const resultEl = document.getElementById('result') as HTMLParagraphElement;

  let pollTimer: number | null = null;
  let observedPending = false;

  async function send(msg: SnitchMessage): Promise<SnitchMessage | undefined> {
    return (await chrome.runtime.sendMessage(msg)) as SnitchMessage | undefined;
  }

  function render(state: SnitchUiState): void {
    const observing = state === 'observing';
    const pending = state === 'snitchshot_pending';
    const idle = state === 'idle';

    snitchBtn.hidden = !idle;
    cancelBtn.hidden = !observing;
    copyBtn.hidden = !pending;

    // The capture inputs are only meaningful while idle (choosing a snapshot).
    if (field) field.hidden = !idle;
    if (screenshotRow) screenshotRow.hidden = !idle;

    if (observing) {
      stateEl.textContent = 'Watching…';
      resultEl.textContent = 'Collecting browser evidence on the selected tab…';
      resultEl.className = 'result';
    } else if (pending) {
      stateEl.textContent = '';
      resultEl.textContent = 'SNITCHSHOT ready. Copy it, then Ctrl+V anywhere.';
      resultEl.className = 'result';
    } else {
      stateEl.textContent = 'Ready';
      resultEl.textContent = '';
      resultEl.className = 'result';
    }
  }

  async function refreshStatus(fromPoll = false): Promise<void> {
    const response = await send({ type: 'GET_STATUS' } satisfies SnitchMessage);
    if (!response) return;

    if (response.type === 'STATUS_RESULT') {
      render(response.state);
      if (response.state === 'observing') {
        if (!observedPending) {
          observedPending = true;
          resultEl.textContent =
            'Collecting browser evidence on the selected tab…';
        }
        schedulePoll();
      } else if (response.state === 'snitchshot_pending') {
        stopPoll();
        // Pre-fetch the report into popup memory before the user gestures, so
        // the COPY click can run execCommand('copy') synchronously within the
        // activation window (awaiting GET_SNITCHSHOT mid-gesture forfeits it).
        void fetchReportForCache();
        if (observedPending) {
          observedPending = false;
          stateEl.textContent = 'Done ✓';
          resultEl.textContent = 'Report ready. Press COPY SNITCHSHOT.';
          resultEl.className = 'result ok';
        }
      } else if (fromPoll) {
        // Returned to idle by the backend (e.g. session completed while we were
        // polling) without a fresh user action.
        stopPoll();
        observedPending = false;
      }
    } else if (response.type === 'EVIDENCE_ERROR') {
      stopPoll();
      observedPending = false;
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
    stateEl.textContent = 'Error';
    resultEl.textContent = message;
    resultEl.className = 'result err';
  }

  function logDiagnostic(label: string, text: string): void {
    console.info(`[DEVSnitcher:${CLIPBOARD_BUILD}] ${label} ${fingerprint(text)}`);
  }

  // Fetch the pending report into popup memory. Runs off the gesture path (from
  // status polling / initial render) so the COPY click below never awaits a
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
    stateEl.textContent = 'Starting…';
    resultEl.textContent = '';
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
        await refreshStatus();
      } else if (response.type === 'SNITCH_ACCEPTED') {
        observedPending = true;
        await refreshStatus();
      } else {
        showError('Unexpected response from background.');
      }
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
        observedPending = false;
        render('idle');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      cancelBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    resultEl.textContent = 'Copying to clipboard…';
    resultEl.className = 'result';

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
            content.type === 'EVIDENCE_ERROR'
              ? content.error
              : 'Failed to read SNITCHSHOT',
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
      // A confirmed clear is required before reporting success; the report must
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
      stopPoll();
      observedPending = false;
      await refreshStatus();
      stateEl.textContent = 'Copied ✓';
      resultEl.textContent = 'Report on clipboard. Now press Ctrl+V anywhere.';
      resultEl.className = 'result ok';
    } catch (err) {
      // Buffer is retained; stay in COPY so the user can retry.
      showError(err instanceof Error ? err.message : 'Copy failed');
    } finally {
      copyBtn.disabled = false;
    }
  });

  void refreshStatus();
});