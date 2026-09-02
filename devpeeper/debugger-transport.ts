/**
 * Narrow `chrome.debugger` transport used by DEVPEEPER's Chromium observer.
 *
 * Keeping this behind a tiny interface lets the observer lifecycle be tested
 * against a mocked transport without a live Chrome debugger session. The real
 * adapter simply forwards to `chrome.debugger`.
 */

export interface DebuggerTarget {
  tabId?: number;
}

export interface DebuggerTransport {
  attach(target: DebuggerTarget, version: string): Promise<void>;
  detach(target: DebuggerTarget): Promise<void>;
  sendCommand(target: DebuggerTarget, method: string, params?: unknown): Promise<unknown>;
  onEvent(
    listener: (target: DebuggerTarget, method: string, params?: unknown) => void,
  ): () => void;
  onDetach(listener: (target: DebuggerTarget, reason: string) => void): () => void;
}

/**
 * Adapts the real `chrome.debugger` API to the DEVPEEPER transport contract.
 * Only called from background extension context where `chrome.debugger` exists.
 */
export function chromeDebuggerTransport(): DebuggerTransport {
  return {
    attach: (target, version) => chrome.debugger.attach(target, version),
    detach: (target) => chrome.debugger.detach(target),
    sendCommand: (target, method, params) =>
      chrome.debugger.sendCommand(target, method, params as object | undefined),
    onEvent(listener) {
      const fn = (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: object,
      ) => listener(source, method, params);
      chrome.debugger.onEvent.addListener(fn);
      return () => chrome.debugger.onEvent.removeListener(fn);
    },
    onDetach(listener) {
      const fn = (source: chrome.debugger.Debuggee, reason: string) =>
        listener(source, reason);
      chrome.debugger.onDetach.addListener(fn);
      return () => chrome.debugger.onDetach.removeListener(fn);
    },
  };
}
