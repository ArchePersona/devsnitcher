export interface ClipboardWriteInput {
  text: string;
  imageDataUrl?: string;
}

export async function writeToClipboard(input: ClipboardWriteInput): Promise<void> {
  const { text, imageDataUrl } = input;

  if (imageDataUrl && typeof ClipboardItem !== 'undefined') {
    try {
      const blob = await dataUrlToBlob(imageDataUrl);
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'image/png': blob,
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Fall through to text-only write.
    }
  }

  await navigator.clipboard.writeText(text);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
