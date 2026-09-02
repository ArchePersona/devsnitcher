/**
 * DEVPEEPER bounded page probe.
 *
 * This function is executed through `chrome.scripting.executeScript()` from
 * extension-controlled code. Chrome serializes the function source (and its
 * nested helpers) and runs it inside the target tab, then carries the returned
 * value back to the extension in an `InjectionResult`.
 *
 * It therefore references NO module-scope bindings: everything it needs is
 * nested inside the function or read directly from browser globals in the
 * isolated extension world.
 *
 * It is intentionally bounded:
 * - reads only environment, focused DOM context and current selection;
 * - starts no listeners, performs no monkey-patching, keeps no page-global state;
 * - returns plain serializable data;
 * - does NOT use `window.postMessage`. The result travels back through Chrome,
 *   so hostile page JS cannot forge this observation's response.
 *
 * The isolated world choice is deliberate: the extension's copy of the DOM
 * cannot be interfered with by MAIN-world page script while we read it.
 */

export interface BoundedSnapshotDom {
  selector: string;
  html: string;
  className: string;
  tagName: string;
  isFocused: boolean;
}

export interface BoundedSnapshot {
  environment: {
    url: string;
    title: string;
    browser: string;
    platform: string;
    viewport: { width: number; height: number };
  };
  dom: BoundedSnapshotDom | null;
}

/** Reads bounded browser state and returns a plain serializable snapshot. */
export function snapshotProbe(): BoundedSnapshot {
  const environment = {
    url: location.href,
    title: document.title,
    browser: parseBrowser(navigator.userAgent),
    platform: navigator.platform,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };

  const selectionNode = readSelectionNode();
  const el = selectionNode ?? document.activeElement;
  const dom =
    el && el instanceof Element
      ? {
          selector: buildSelector(el),
          html: truncate(el.outerHTML, 4000),
          className: typeof el.className === 'string' ? el.className : '',
          tagName: el.tagName.toLowerCase(),
          isFocused: el === document.activeElement,
        }
      : null;

  return { environment, dom };

  function parseBrowser(ua: string): string {
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return ua;
  }

  function readSelectionNode(): Element | null {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const node = selection.anchorNode;
      if (node && node.nodeType === 1) return node as Element;
      if (node && node.parentElement) return node.parentElement;
    }
    return null;
  }

  function buildSelector(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1) {
      if (cur.id) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      let sel = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const children = Array.from(parent.children) as Element[];
        const same = children.filter((c) => c.tagName === cur!.tagName);
        const idx = same.indexOf(cur);
        if (same.length > 1 && idx > -1) {
          sel += `:nth-of-type(${idx + 1})`;
        }
      }
      parts.unshift(sel);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max) + '\u2026';
  }
}
