import { redactEvidence } from '../../redaction/index';
import { buildMarkdownReport } from '../../report/markdown';
import { captureScreenshot } from '../../collectors/screenshot';
import type { Evidence, SnitchMessage } from '../../shared/types';

const CACHE_KEY_STORAGE = 'devsnitcher:evidence-cache-key:v1';
const CACHE_RECORD_PREFIX = 'devsnitcher:evidence-cache:v1:';
const CACHE_AAD_PREFIX = 'devsnitcher-evidence-cache:v1:';

interface EncryptedEvidenceRecord {
  version: 1;
  url: string;
  capturedAt: number;
  iv: string;
  ciphertext: string;
}

void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

chrome.runtime.onMessage.addListener(
  (msg: SnitchMessage, sender, sendResponse) => {
    if (msg?.type === 'CACHE_EVIDENCE') {
      if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.tab.url) {
        sendResponse({
          type: 'EVIDENCE_ERROR',
          error: 'Rejected evidence cache write from untrusted sender',
        } satisfies SnitchMessage);
        return false;
      }

      encryptAndStoreEvidence(sender.tab.id, sender.tab.url, msg.evidence)
        .then(() => sendResponse({ type: 'CACHE_STORED' } satisfies SnitchMessage))
        .catch((err) =>
          sendResponse({
            type: 'EVIDENCE_ERROR',
            error: String(err),
          } satisfies SnitchMessage),
        );
      return true;
    }

    if (msg?.type !== 'SNITCH') return false;

    (async () => {
      try {
        const tab = getTabFromSender(sender) ?? (await getActiveTab());

        await ensureContentScript(tab.id!);
        await refreshEvidenceCache(tab.id!);

        const evidence = await readCachedEvidence(tab.id!, tab.url!);
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

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(cacheRecordKey(tabId));
});

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

  throw new Error(
    'DEVSnitcher could not attach to this tab. The page may enforce a CSP that blocks injection, or the tab was opened before the extension was installed. Refresh the page and try again.',
  );
}

async function refreshEvidenceCache(tabId: number): Promise<void> {
  const response = (await chrome.tabs.sendMessage(
    tabId,
    { type: 'REFRESH_CACHE' } satisfies SnitchMessage,
  )) as SnitchMessage | undefined;

  if (!response) {
    throw new Error('No response from content script');
  }

  if (response.type === 'EVIDENCE_ERROR') {
    throw new Error(response.error);
  }

  if (response.type !== 'CACHE_REFRESHED') {
    throw new Error('Unexpected response from content script');
  }
}

async function encryptAndStoreEvidence(
  tabId: number,
  url: string,
  evidence: Evidence,
): Promise<void> {
  const key = await getOrCreateCacheKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(evidence));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: cacheAdditionalData(tabId),
    },
    key,
    plaintext,
  );

  const record: EncryptedEvidenceRecord = {
    version: 1,
    url,
    capturedAt: Date.now(),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };

  await chrome.storage.session.set({ [cacheRecordKey(tabId)]: record });
}

async function readCachedEvidence(tabId: number, expectedUrl: string): Promise<Evidence> {
  const storageKey = cacheRecordKey(tabId);
  const stored = await chrome.storage.session.get(storageKey);
  const record = stored[storageKey] as EncryptedEvidenceRecord | undefined;

  if (!record || record.version !== 1) {
    throw new Error('No encrypted evidence cache is available for this tab');
  }

  if (record.url !== expectedUrl) {
    await chrome.storage.session.remove(storageKey);
    throw new Error('Encrypted evidence cache does not match the active page');
  }

  const key = await getOrCreateCacheKey();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(record.iv),
      additionalData: cacheAdditionalData(tabId),
    },
    key,
    base64ToBytes(record.ciphertext),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as Evidence;
}

async function getOrCreateCacheKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.session.get(CACHE_KEY_STORAGE);
  const encoded = stored[CACHE_KEY_STORAGE];

  if (typeof encoded === 'string' && encoded.length > 0) {
    return crypto.subtle.importKey(
      'raw',
      base64ToBytes(encoded),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({
    [CACHE_KEY_STORAGE]: bytesToBase64(new Uint8Array(raw)),
  });

  return key;
}

function cacheRecordKey(tabId: number): string {
  return `${CACHE_RECORD_PREFIX}${tabId}`;
}

function cacheAdditionalData(tabId: number): Uint8Array {
  return new TextEncoder().encode(`${CACHE_AAD_PREFIX}${tabId}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
