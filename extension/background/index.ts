import { redactEvidence } from '../../redaction/index';
import { buildMarkdownReport } from '../../report/markdown';
import { captureScreenshot } from '../../collectors/screenshot';
import type { Evidence, SnitchMessage } from '../../shared/types';

chrome.runtime.onMessage.addListener(
  (msg: SnitchMessage, sender, sendResponse) => {
    if (msg?.type !== 'SNITCH') return false;

    (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) throw new Error('No active tab');

        const evidence = await collectEvidence(tabId);
        const screenshot = msg.screenshot
          ? await captureScreenshot(sender.tab?.windowId)
          : null;
        evidence.screenshot = screenshot;

        const redacted = redactEvidence(evidence);
        const report = buildMarkdownReport({
          evidence: redacted,
          userNotes: msg.userNotes ?? '',
        });

        sendResponse({
          type: 'SNITCH_RESULT',
          report,
          screenshotDataUrl: screenshot?.dataUrl,
        } satisfies SnitchMessage);
      } catch (err) {
        sendResponse({
          type: 'SNITCH_ERROR',
          error: String(err),
        } satisfies SnitchMessage);
      }
    })();

    return true;
  },
);

async function collectEvidence(tabId: number): Promise<Evidence> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'COLLECT_EVIDENCE' } satisfies SnitchMessage).catch(() => {
      // ignore send error, the listener will catch the response
    });

    const handler = (msg: SnitchMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      if (msg?.type !== 'EVIDENCE_RESULT') return;
      chrome.runtime.onMessage.removeListener(handler);
      clearTimeout(timer);
      resolve(msg.evidence);
    };

    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('Timeout waiting for page evidence'));
    }, 8000);

    chrome.runtime.onMessage.addListener(handler);
  });
}