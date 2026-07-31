import type { SnitchMessage } from '../../shared/types';
import { writeToClipboard } from '../../report/clipboard';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('snitch') as HTMLButtonElement;
  const notes = document.getElementById('notes') as HTMLTextAreaElement;
  const screenshotCb = document.getElementById('screenshot') as HTMLInputElement;
  const stateEl = document.getElementById('state') as HTMLSpanElement;
  const resultEl = document.getElementById('result') as HTMLParagraphElement;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
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
        await writeToClipboard({
          text: response.report,
          imageDataUrl: response.screenshotDataUrl,
        });
        stateEl.textContent = 'Copied! ✓';
        resultEl.textContent = 'Report copied to clipboard. Paste into your AI.';
        resultEl.className = 'result ok';
      }
    } catch (err) {
      stateEl.textContent = 'Error';
      resultEl.textContent = err instanceof Error ? err.message : 'Unknown error';
      resultEl.className = 'result err';
    } finally {
      btn.disabled = false;
    }
  });
});