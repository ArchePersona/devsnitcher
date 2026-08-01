import { redactEvidence } from '../../redaction/index';
import { buildMarkdownReport } from '../../report/markdown';
import { captureScreenshot } from '../../collectors/screenshot';
import type { Evidence, SnitchMessage } from '../../shared/types';

chrome.runtime.onMessage.addListener(
  (msg: SnitchMessage, _sender, sendResponse) => {
    if (msg?.type !== 'SNITCH') return false;

    (async () => {
      try {
        const tab = getTabFromSender(_sender) ?? (await getActiveTab());

        await ensureContentScript(tab.id!);

        const evidence = await collectEvidence(tab.id!);
        const screenshot = msg.screenshot
          ? await captureScreenshot(tab.windowId)
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

function getTabFromSender(sender?: chrome.runtime.MessageSender): chrome.tabs.Tab | undefined {
  if (sender?.tab?.id && sender.tab.url) {
    const url = sender.tab.url;
    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:')
    ) {
      return undefined;
    }
    return sender.tab;
  }
  return undefined;
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const tab = tabs[0];

  if (!tab?.id) {
    throw new Error('No active tab found. Open a normal browser tab and try again.');
  }

  if (!tab.url) {
    throw new Error('Active tab has no URL.');
  }

  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:')
  ) {
    throw new Error('DEVSnitcher cannot inspect browser-internal pages.');
  }

  return tab;
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      { type: 'PING' } satisfies SnitchMessage,
    )) as SnitchMessage | undefined;
    return response?.type === 'PONG';
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await pingContentScript(tabId)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('DEVSnitcher could not attach to this tab. Refresh the page and try again.');
}

async function collectEvidence(tabId: number): Promise<Evidence> {
  const response = (await chrome.tabs.sendMessage(
    tabId,
    { type: 'COLLECT_EVIDENCE' } satisfies SnitchMessage,
  )) as SnitchMessage | undefined;

  if (!response) {
    throw new Error('No response from content script');
  }

  if (response.type === 'EVIDENCE_ERROR') {
    throw new Error(response.error);
  }

  if (response.type !== 'EVIDENCE_RESULT') {
    throw new Error('Unexpected response from content script');
  }

  return response.evidence;
}