import { redactHeaders } from './headers';
import { redactCookieString } from './cookies';
import { redactTokens } from './tokens';
import { redactUrl, redactUrlsInText } from './urls';
import type { Evidence, NetworkEntry, ConsoleEntry, JsErrorEntry, DomContext } from '../shared/types';

export function redactText(text: string): string {
  return redactTokens(redactUrlsInText(text));
}

function redactStack(stack: string): string {
  return redactTokens(redactUrlsInText(stack));
}

export function redactNetworkEntry(entry: NetworkEntry): NetworkEntry {
  return {
    ...entry,
    url: redactUrl(entry.url).url,
    requestHeaders: redactHeaders(entry.requestHeaders),
    responsePreview: redactTokens(redactUrlsInText(entry.responsePreview)),
  };
}

export function redactConsoleEntry(entry: ConsoleEntry): ConsoleEntry {
  return {
    ...entry,
    message: redactText(entry.message),
    stack: entry.stack ? redactStack(entry.stack) : undefined,
  };
}

export function redactJsErrorEntry(entry: JsErrorEntry): JsErrorEntry {
  return {
    ...entry,
    message: redactText(entry.message),
    stack: entry.stack ? redactStack(entry.stack) : entry.stack,
  };
}

export function redactDomContext(dom: DomContext): DomContext {
  return {
    ...dom,
    html: redactText(dom.html),
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

export { redactHeaders, redactCookieString, redactTokens, redactUrl, redactUrlsInText };
