import { redactEvidence } from '../../redaction/index';
import { buildMarkdownReport } from '../../report/markdown';
import { captureScreenshot } from '../../collectors/screenshot';
import { SnitchshotBuffer } from './snitchshot-buffer';
import { SnitchSessionManager, type SnitchSessionContext } from './snitch-session';
import { chromeDebuggerTransport } from '../../devpeeper/debugger-transport';
import { snapshotProbe, type BoundedSnapshot } from '../../devpeeper/snapshot-probe';
import {
  makeBoundedObservation,
  type InjectionResultLike,
} from '../../devpeeper/observation';
import type { DomContext, EnvironmentInfo, SnitchMessage, SnitchUiState } from '../../shared/types';

// SNITCH acquisition session. DEVPEEPER attaches a debugger ONLY while a
// user-initiated SNITCH acquisition is live. There is no automatic active-tab
// attachment and no observation before SNITCH. At most one live session exists
// globally; its source tab is immutable and tab activation is never authority.
const session = new SnitchSessionManager({
  transport: () => chromeDebuggerTransport(),
  isSupported: isSupportedTabUrl,
  acquireBounded: probeBoundedObservation,
  onComplete: async (evidence, ctx) => {
    const redacted = redactEvidence(evidence);
    const report = buildMarkdownReport({
      evidence: redacted,
      userNotes: ctx.userNotes,
    });
    // Boundary A — report built. Metadata-only fingerprint (length + hash).
    console.log(`[snitch] report-built ${reportMeta(report)}`);
    try {
      await snitchshot.fill(report, ctx.tabId);
      // Boundary B — report stored in the private buffer.
      console.log(`[snitch] buffer-fill ${reportMeta(report)}`);
    } catch (err) {
      console.log(
        `[snitch] buffer-fill FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    // Boundary C — the buffer accepts the report (retrieval check). A paced peek
    // that throws is a genuine storage failure, surfaced as a failed session,
    // never as an empty buffer.
    try {
      const record = await snitchshot.peek();
      if (record?.report) {
        console.log(`[snitch] buffer-peek ${reportMeta(record.report)}`);
      } else {
        console.log('[snitch] buffer-peek FAILED (empty after fill)');
      }
    } catch (err) {
      console.log(
        `[snitch] buffer-peek FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  },
});

/** Metadata-only report fingerprint (length + hash). Never includes report contents. */
function reportMeta(report: string): string {
  let hash = 0;
  for (let i = 0; i < report.length; i++) {
    hash = ((hash << 5) - hash + report.charCodeAt(i)) | 0;
  }
  return `len=${report.length} hash=${hash}`;
}

chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => {
    // The default access level (trusted contexts only) already applies.
  });

// Private DEVSnitcher-owned SNITCHSHOT buffer. Global, session-scoped, restricted
// to trusted contexts. It is the authoritative store for the clipboard release
// lifecycle and is cleared only after a confirmed system clipboard write, never
// by tab switching.
const snitchshot = new SnitchshotBuffer({
  get: async (key) => chrome.storage.session.get(key),
  set: async (items) => {
    await chrome.storage.session.set(items);
  },
  remove: async (key) => {
    await chrome.storage.session.remove(key);
  },
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // A closed source tab terminates its SNITCH session; it never migrates to
  // another tab. Nothing is attached or observed before SNITCH.
  void session.handleRemoved(tabId);
});

chrome.runtime.onMessage.addListener(
  (msg: SnitchMessage, sender, sendResponse) => {
    if (msg?.type === 'GET_STATUS') {
      // Popup derives its interactive state from authoritative background/session
      // state. Refuse tab-relayed senders so page/content scripts cannot probe it.
      if (sender.tab) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }
      void composeStatus().then((result) => sendResponse(result satisfies SnitchMessage));
      return true;
    }

    if (msg?.type === 'CANCEL_SNITCH') {
      // Only the trusted popup may cancel. Refuse tab-relayed senders.
      if (sender.tab) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }
      void session
        .cancel()
        .then(() => sendResponse({ type: 'CANCEL_ACCEPTED' } satisfies SnitchMessage))
        .catch((err) =>
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: String(err),
          } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type === 'GET_SNITCHSHOT') {
      // The trusted popup fetches the pending report to write it to the ordinary
      // OS clipboard. Content scripts / page cannot read the private buffer.
      if (sender.tab) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }
      void snitchshot
        .peek()
        .then((record) => {
          if (record) {
            // Boundary D — GET_SNITCHSHOT response. The popup receives the same
            // report the buffer holds; fingerprint must match boundary A.
            console.log(`[background] get-snitchshot ${reportMeta(record.report)}`);
            sendResponse({
              type: 'SNITCHSHOT_CONTENT',
              report: record.report,
            } satisfies SnitchMessage);
          } else {
            sendResponse({
              type: 'EVIDENCE_ERROR',
              error: 'No SNITCHSHOT is pending.',
            } satisfies SnitchMessage);
          }
        })
        .catch((err) =>
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: String(err),
          } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type === 'CLIPBOARD_RELEASED') {
      // The popup has written the report to the ordinary OS clipboard and only
      // now confirms release. The private buffer is authoritative until this
      // confirmation. Boundary I → J: CLIPBOARD_CLEARED is sent ONLY when the
      // buffer is verified empty after removal; a failed/unconfirmed release
      // keeps the SNITCHSHOT pending and surfaces an error instead.
      if (sender.tab) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Refused from a tab context.',
        } satisfies SnitchMessage);
        return false;
      }
      void (async () => {
        console.log('[background] release-request');
        try {
          await snitchshot.clear();
          const stillOccupied = await snitchshot.isOccupied();
          if (stillOccupied) {
            console.log('[background] buffer-clear FAILED (still occupied)');
            sendResponse({
              type: 'EVIDENCE_ERROR',
              error: 'The private SNITCHSHOT could not be cleared; it is still pending.',
            } satisfies SnitchMessage);
            return;
          }
          console.log('[background] buffer-cleared');
          sendResponse({ type: 'CLIPBOARD_CLEARED' } satisfies SnitchMessage);
        } catch (err) {
          console.log(
            `[background] buffer-clear FAILED: ${err instanceof Error ? err.message : String(err)}`,
          );
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: `The private SNITCHSHOT could not be cleared: ${
              err instanceof Error ? err.message : String(err)
            }`,
          } satisfies SnitchMessage);
        }
      })();
      return true;
    }

    if (msg?.type !== 'SNITCH') return false;

    // Privileged action: only the extension popup may trigger SNITCH.
    // Messages relayed from a tab (content script) are refused.
    if (sender.tab) {
      sendResponse({
        type: 'SNITCH_ERROR',
        error: 'SNITCH can only be triggered from the DEVSnitcher popup.',
      } satisfies SnitchMessage);
      return false;
    }

    (async () => {
      try {
        // Does nothing until SNITCH is pressed. Two independent gates:
        // the active session gate and the outstanding-SNITCHSHOT gate.
        if (session.isObserving()) {
          sendResponse({
            type: 'SNITCH_ERROR',
            error: 'A SNITCH session is already running.',
          } satisfies SnitchMessage);
          return;
        }

        if (await snitchshot.isOccupied()) {
          sendResponse({
            type: 'SNITCH_ERROR',
            error: 'SNITCHSHOT pending — copy it before taking another.',
          } satisfies SnitchMessage);
          return;
        }

        const tab = await getActiveTab();

        // Capture the requested screenshot at SNITCH time for the session report.
        const screenshot = msg.screenshot
          ? await captureScreenshot(tab.windowId)
          : null;

        const started = await session.start({
          tabId: tab.id!,
          tabUrl: tab.url!,
          windowId: tab.windowId,
          userNotes: msg.userNotes ?? '',
          screenshot: msg.screenshot,
          screenshotInfo: screenshot ?? undefined,
        } satisfies SnitchSessionContext);

        if (!started) {
          sendResponse({
            type: 'SNITCH_ERROR',
            error: 'A SNITCH session is already running.',
          } satisfies SnitchMessage);
          return;
        }

        // start() ran the full acquisition before resolving. Report the outcome
        // from the resulting state: an occupied buffer means the SNITCHSHOT is
        // actually pending and retrievable; otherwise surface the failure.
        if (await snitchshot.isOccupied()) {
          sendResponse({
            type: 'SNITCH_ACCEPTED',
            tabId: tab.id!,
            windowId: tab.windowId,
          } satisfies SnitchMessage);
        } else {
          sendResponse({
            type: 'SNITCH_ERROR',
            error: session.getLastError() ?? 'SNITCH acquisition produced no report.',
          } satisfies SnitchMessage);
        }
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

async function composeStatus(): Promise<
  | { type: 'STATUS_RESULT'; state: SnitchUiState; error?: string }
  | { type: 'EVIDENCE_ERROR'; error: string }
> {
  try {
    const error = session.getLastError() ?? undefined;
    if (session.isObserving()) {
      return { type: 'STATUS_RESULT', state: 'observing', error };
    }
    if (await snitchshot.isOccupied()) {
      return { type: 'STATUS_RESULT', state: 'snitchshot_pending' };
    }
    return { type: 'STATUS_RESULT', state: 'idle', error };
  } catch (err) {
    return {
      type: 'EVIDENCE_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
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

  if (!isSupportedTabUrl(tab.url)) {
    throw new Error('DEVSnitcher cannot inspect browser-internal pages.');
  }

  return tab;
}

function isSupportedTabUrl(url: string): boolean {
  return (
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('edge://') &&
    !url.startsWith('about:')
  );
}

/**
 * Acquires the bounded contextual fields (environment + DOM) for `tabId` via the
 * Chrome-mediated DEVPEEPER bounded probe, run from this trusted extension
 * context (chrome.scripting is unavailable to content scripts). This ties bounded
 * acquisition to the session tab at SNITCH time rather than a rolling cache.
 */
async function probeBoundedObservation(tabId: number): Promise<{
  environment: EnvironmentInfo;
  dom: DomContext | null;
}> {
  const results = await chrome.scripting.executeScript<[], BoundedSnapshot>({
    target: { tabId },
    world: 'ISOLATED',
    func: snapshotProbe,
  });
  const result = results[0] as
    | (InjectionResultLike & { result?: BoundedSnapshot })
    | undefined;
  if (!result || !result.result) {
    throw new Error('DEVPEEPER bounded probe returned no result');
  }
  const observation = makeBoundedObservation(result.result, result, tabId, Date.now());
  return observation.payload;
}
