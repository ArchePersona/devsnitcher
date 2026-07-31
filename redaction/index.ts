import { redactHeaders } from './headers';
import { redactCookieString } from './cookies';
import { redactTokens } from './tokens';
import { redactUrl } from './urls';
import type { Evidence, NetworkEntry, ConsoleEntry, JsErrorEntry, DomContext } from '../shared/types';

export function redactText(text: string): string {
  return redactTokens(redactUrl(text).url);
}

export function redactNetworkEntry(entry: NetworkEntry): NetworkEntry {
  return {
    ...entry,
    url: redactUrl(entry.url).url,
    requestHeaders: redactHeaders(entry.requestHeaders),
    responsePreview: redactTokens(redactUrl(entry.responsePreview).url),
  };
}

export function redactConsoleEntry(entry: ConsoleEntry): ConsoleEntry {
  return {
    ...entry,
    message: redactTokens(entry.message),
    stack: entry.stack ? redactUrl(entry.stack).url : undefined,
  };
}

export function redactJsErrorEntry(entry: JsErrorEntry): JsErrorEntry {
  return {
    ...entry,
    message: redactTokens(entry.message),
    stack: entry.stack ? redactUrl(entry.stack).url : entry.stack,
  };
}

export function redactDomContext(dom: DomContext): DomContext {
  return {
    ...dom,
    html: redactTokens(dom.html),
    className: dom.className,
  };
}

export function redactEvidence(evidence: Evidence): Evidence {
  return {
    ...evidence,
    console: evidence.console.map(redactConsoleEntry),
    network: evidence.network.map(redactNetworkEntry),
    jsErrors: evidence.jsErrors.map(redactJsErrorEntry),
    dom: evidence.dom ? redactDomContext(evidence.dom) : null,
  };
}

export { redactHeaders, redactCookieString, redactTokens, redactUrl };
