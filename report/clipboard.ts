export interface ClipboardWriteInput {
  text: string;
  imageDataUrl?: string;
}

/**
 * Writes text to the ordinary system OS clipboard from the extension popup
 * document (a trusted, extension-controlled page) within the user's explicit
 * COPY SNITCHSHOT gesture.
 *
 * Chrome/Windows are unreliable with `navigator.clipboard.writeText`: it can
 * silently resolve without placing text on the OS clipboard, or reject with
 * `NotAllowedError: Document is not focused`, because the async Clipboard API
 * requires an active, focused document. A resolved promise is therefore NOT
 * proof that the report reached the OS clipboard, and must never authorize
 * clearing the private SNITCHSHOT.
 *
 * Release authority:
 *
 *  - The ordinary text SNITCHSHOT copy path uses `writeTextViaDomCopy` against
 *    a focused, fully selected offscreen textarea. `document.execCommand` is
 *    the synchronous, gesture-bound write available from a popup document; its
 *    returned boolean is the strongest local signal this boundary can produce,
 *    but only the live Windows paste (Ctrl+V) verifies the OS clipboard. The
 *    private SNITCHSHOT stays authoritative until the background confirms the
 *    buffer actually cleared.
 *  - The modern async Clipboard API is used only for the separate image/mixed-
 *    content path (`imageDataUrl`), never for the ordinary text CTA.
 *
 * It never swallows an error: on failure it throws a clear, actionable message
 * so the caller keeps the SNITCHSHOT pending, never shows a false "Copied", and
 * never sends `CLIPBOARD_RELEASED`.
 */
export async function writeToClipboard(input: ClipboardWriteInput): Promise<void> {
  const { text } = input;

  if (typeof text !== 'string') {
    throw new Error('Clipboard copy requires report text.');
  }

  // The image/mixed-content path is a separate release surface that requires
  // the modern async Clipboard API (ClipboardItem). It is not the ordinary
  // text SNITCHSHOT CTA and does not gate text release.
  if (input.imageDataUrl) {
    await writeImageAndText(input);
    return;
  }

  // Ordinary text release: the DOM copy path is the sole, authoritative
  // operation. A resolved navigator.clipboard.writeText() is NOT sufficient —
  // only a confirmed write authorizes release, confirmed later by the buffer
  // clearing.
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
 * Deterministic, metadata-only fingerprint of the report: length and a stable
 * hash. Used to prove the same text reaches each boundary without ever dumping
 * the private report contents.
 */
export function fingerprint(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `len=${text.length} hash=${hash}`;
}

/**
 * Writes `text` to the OS clipboard via `document.execCommand('copy')` against
 * a focused, fully selected offscreen textarea. Throws on failure — it never
 * reports success unless execCommand returned true.
 *
 * Textarea selection is verified with the element's own selection model
 * (`selectionStart`/`selectionEnd`); `document.getSelection()` does not
 * describe a textarea's selection and can never prove the copied text.
 *
 * Emits bounded, metadata-only diagnostics (requested fingerprint, textarea
 * length, element-selected range length, whether the selected range equals the
 * requested report, and the raw execCommand result) so a live test can
 * distinguish "correct report reached the copy mechanism" from "wrong/empty
 * text reached the copy mechanism" and whether the browser wrote (true) or
 * refused (false).
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
  let textareaLen = 0;
  let selectedLen = 0;
  let selectedMatches = false;
  try {
    console.log(`[clipboard] write-attempt ${fingerprint(text)}`);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    // The element selection model is the correct one for a textarea:
    // document.getSelection() does not describe selection inside it.
    textareaLen = textarea.value.length;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    selectedLen = selEnd - selStart;
    selectedMatches = textarea.value.substring(selStart, selEnd) === text;
    succeeded = doc.execCommand('copy');
  } finally {
    textarea.remove();
  }

  console.log(
    `[clipboard] write-result ` +
      `result=${succeeded} ` +
      `textareaLen=${textareaLen} selectedLen=${selectedLen} ` +
      `selectedMatch=${selectedMatches}`,
  );

  if (!succeeded) {
    throw new Error('The system clipboard rejected the copy. Try pressing COPY again.');
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}