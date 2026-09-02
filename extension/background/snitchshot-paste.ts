/**
 * DEVSnitcher-owned paste.
 *
 * This function is injected into the active supported tab via
 * `chrome.scripting.executeScript` from the trusted background service worker
 * (extension-initiated, never page-commanded). It inserts the SNITCHSHOT report
 * into the currently focused editable target, preserving ordinary insertion
 * semantics: insert at the caret, replace the selection when one exists, and do
 * not replace the whole field preemptively.
 *
 * It references NO module-scope bindings — the report text is passed through
 * the `args` of `chrome.scripting.executeScript` — so it can be serialized and
 * executed inside the target tab, mirroring the bounded snapshot probe.
 *
 * Returns `true` only when a supported editable target received the text, so
 * the background clears the private buffer solely on a confirmed insertion.
 */

export interface PasteResult {
  /** True when the report was inserted into a supported editable target. */
  ok: boolean;
  /** Human-readable reason when insertion failed. */
  reason?: string;
}

/** Injects `text` at the focused editable target's caret/selection. */
export function pasteReport(text: string): PasteResult {
  const el = document.activeElement;
  if (!el) {
    return { ok: false, reason: 'No focused element to paste into.' };
  }

  const target = el as HTMLElement;

  // Content-editable surfaces (rich editors, code editors, email composers).
  if (target.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return { ok: false, reason: 'Focused editor has no selection/caret.' };
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    return { ok: true };
  }

  // Plain text inputs and textareas.
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    target.value = next;
    const caret = start + text.length;
    try {
      target.setSelectionRange(caret, caret);
    } catch {
      // Some inputs (e.g. type=number) restrict selection; ignore.
    }
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    return { ok: true };
  }

  return { ok: false, reason: 'Focused element is not a supported editable target.' };
}