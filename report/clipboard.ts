export interface ClipboardWriteInput {
  text: string;
  imageDataUrl?: string;
}

/**
 * Reliably writes text to the ordinary system OS clipboard from the extension
 * popup document (a trusted, extension-controlled page).
 *
 * Chrome/Windows are unreliable with `navigator.clipboard.writeText`: it can
 * silently resolve without placing text on the OS clipboard, or reject with
 * `NotAllowedError: Document is not focused`, because the async Clipboard API
 * requires an active, focused document. That makes it unsafe to treat a
 * resolved promise as proof the write reached the OS clipboard — the private
 * SNITCHSHOT must not be cleared on that basis alone.
 *
 * So this helper is layered and only reports success on a CONFIRMED OS write:
 *
 *  1. `navigator.clipboard.write / writeText` first. If it resolves, the
 *     runtime has accepted the write — treat as success.
 *  2. Otherwise fall back to `document.execCommand('copy')` against a focused,
 *     selected offscreen textarea. Unlike the async Clipboard API, `execCommand`
 *     does not depend on the document-focus/user-activation heuristics and
 *     returns a truthful boolean. This is the same mechanism as Chrome's own
 *     offscreen-clipboard-write sample.
 *
 * It never swallows an error: on total failure it throws a clear, actionable
 * message so the caller keeps the SNITCHSHOT pending, never shows a false
 * "Copied", and never sends `CLIPBOARD_RELEASED`.
 */
export async function writeToClipboard(input: ClipboardWriteInput): Promise<void> {
  const { text } = input;

  if (typeof text !== 'string') {
    throw new Error('Clipboard copy requires report text.');
  }

  // Image + text path is only available where the modern async Clipboard API
  // exists and is focused; degrade to the text-only path otherwise.
  if (input.imageDataUrl) {
    try {
      await writeImageAndText(input);
      return;
    } catch {
      // Fall through to text-only copy below.
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the execCommand path.
    }
  }

  writeTextViaDomCopy(text);
}

async function writeImageAndText(input: ClipboardWriteInput): Promise<void> {
  if (typeof ClipboardItem === 'undefined') {
    throw new Error('ClipboardItem unavailable');
  }
  const blob = await dataUrlToBlob(input.imageDataUrl as string);
  const item = new ClipboardItem({
    'text/plain': new Blob([input.text], { type: 'text/plain' }),
    'image/png': blob,
  });
  await navigator.clipboard.write([item]);
}

/**
 * Writes `text` to the OS clipboard via `document.execCommand('copy')`.
 * Throws on failure — it never reports success unless execCommand returned true.
 */
export function writeTextViaDomCopy(text: string): void {
  const doc = typeof document === 'undefined' ? null : document;
  if (!doc || typeof doc.execCommand !== 'function') {
    throw new Error('Clipboard write is unavailable in this context.');
  }

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  // Must be in the layout tree and selectable for execCommand('copy') to work;
  // place it offscreen rather than display:none, which can break selection.
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(textarea);

  let succeeded = false;
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    succeeded = doc.execCommand('copy');
  } finally {
    textarea.remove();
  }

  if (!succeeded) {
    throw new Error('The system clipboard rejected the copy. Try pressing COPY again.');
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}