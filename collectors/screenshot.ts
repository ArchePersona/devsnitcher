import type { ScreenshotInfo } from '../shared/types';

export async function captureScreenshot(windowId?: number): Promise<ScreenshotInfo | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    return null;
  }
  try {
    const dataUrl = await captureTab(windowId);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
    return {
      dataUrl,
      width: 0,
      height: 0,
    };
  } catch {
    return null;
  }
}

function captureTab(windowId?: number): Promise<string> {
  const opts: chrome.tabs.CaptureVisibleTabOptions = { format: 'png' };
  return new Promise((resolve, reject) => {
    if (windowId !== undefined) {
      chrome.tabs.captureVisibleTab(windowId, opts, handler);
    } else {
      chrome.tabs.captureVisibleTab(opts, handler);
    }
    function handler(dataUrl: string) {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(dataUrl);
    }
  });
}