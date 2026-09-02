import type { SnitchMessage } from '../../shared/types';

document.addEventListener('DOMContentLoaded', () => {
  const snitchBtn = document.getElementById('snitch') as HTMLButtonElement;
  const pasteBtn = document.getElementById('paste') as HTMLButtonElement;
  const notes = document.getElementById('notes') as HTMLTextAreaElement;
  const screenshotCb = document.getElementById('screenshot') as HTMLInputElement;
  const field = document.querySelector('.field') as HTMLElement;
  const screenshotRow = document.querySelector('.checkbox') as HTMLElement;
  const stateEl = document.getElementById('state') as HTMLSpanElement;
  const resultEl = document.getElementById('result') as HTMLParagraphElement;

  async function refreshStatus(): Promise<void> {
    const response = (await chrome.runtime.sendMessage({
      type: 'SNITCHSHOT_STATUS',
    } satisfies SnitchMessage)) as SnitchMessage | undefined;
    const occupied = response?.type === 'SNITCHSHOT_STATUS_RESULT' && response.occupied;
    render(occupied);
  }

  function render(occupied: boolean): void {
    snitchBtn.hidden = occupied;
    pasteBtn.hidden = !occupied;
    field.hidden = occupied;
    screenshotRow.hidden = occupied;

    if (occupied) {
      stateEl.textContent = '';
      resultEl.textContent = 'SNITCHSHOT pending. Paste it before taking another SNITCH.';
      resultEl.className = 'result';
    } else {
      stateEl.textContent = 'Ready';
      resultEl.textContent = '';
      resultEl.className = 'result';
    }
  }

  snitchBtn.addEventListener('click', async () => {
    snitchBtn.disabled = true;
    stateEl.textContent = 'Capturing…';
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
        throw new Error(response.error);
      }

      if (response.type === 'SNITCH_RESULT') {
        stateEl.textContent = 'Snitched ✓';
        resultEl.textContent =
          'Report is ready. Focus an editable field, then paste it with PASTE SNITCHSHOT.';
        resultEl.className = 'result ok';
        await refreshStatus();
      }
    } catch (err) {
      stateEl.textContent = 'Error';
      resultEl.textContent = err instanceof Error ? err.message : 'Unknown error';
      resultEl.className = 'result err';
    } finally {
      snitchBtn.disabled = false;
    }
  });

  pasteBtn.addEventListener('click', async () => {
    pasteBtn.disabled = true;
    resultEl.textContent = 'Pasting into focused field…';
    resultEl.className = 'result';

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'PASTE_SNITCHSHOT',
      } satisfies SnitchMessage)) as SnitchMessage | undefined;

      if (!response) throw new Error('No response from background');

      if (response.type === 'PASTE_SNITCHSHOT_RESULT' && response.pasted) {
        resultEl.textContent = 'Pasted ✓';
        resultEl.className = 'result ok';
        await refreshStatus();
      } else {
        const error =
          response.type === 'PASTE_SNITCHSHOT_RESULT' ? response.error : 'Paste failed';
        throw new Error(error ?? 'Paste failed');
      }
    } catch (err) {
      resultEl.textContent = err instanceof Error ? err.message : 'Paste failed';
      resultEl.className = 'result err';
      // Buffer is retained; stay in paste mode so the user can retry.
      await refreshStatus();
    } finally {
      pasteBtn.disabled = false;
    }
  });

  void refreshStatus();
});