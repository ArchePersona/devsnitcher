import type { DomContext } from '../shared/types';

export function collectDom(selection: Element | null): DomContext | null {
  const el =
    selection ??
    document.activeElement ??
    null;
  if (!el || !(el instanceof Element)) return null;

  return {
    selector: buildSelector(el),
    html: truncate(el.outerHTML, 4000),
    className: el.className?.toString() ?? '',
    tagName: el.tagName.toLowerCase(),
    isFocused: el === document.activeElement,
  };
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
  return s.length <= max ? s : s.slice(0, max) + '…';
}
