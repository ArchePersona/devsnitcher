import type { ScreenshotInfo } from '../shared/types';

export async function captureScreenshot(windowId?: number): Promise<ScreenshotInfo | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    return null;
  }
  try {
    const dataUrl = await captureTab(windowId);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
    const { width, height } = await readImageSize(dataUrl);
    return {
      dataUrl,
      width,
      height,
    };
  } catch {
    return null;
  }
}

async function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'undefined') {
    return { width: 0, height: 0 };
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    if (typeof bitmap.close === 'function') bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
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