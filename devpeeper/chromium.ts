import type { ConsoleEntry, JsErrorEntry, NetworkEntry } from '../shared/types';
import type { ChromiumObservation } from './observation';
import type { DebuggerTransport, DebuggerTarget } from './debugger-transport';
import {
  NetworkTracker,
  decodeResponseBody,
  type GetResponseBodyResult,
  type LoadingFailedParams,
  type LoadingFinishedParams,
  type RequestWillBeSentParams,
  type ResponseReceivedParams,
} from './network-normalizer';
import {
  normalizeConsoleApi,
  normalizeExceptionThrown,
  type ConsoleApiParams,
  type ExceptionThrownParams,
} from './runtime-normalizer';

/**
 * Passive observation lifecycle contract (sibling to PEEP's `ExecutionAdapter`).
 *
 * This is passive browser observation, NOT command submission. It deliberately
 * has no `submit` and no execution methods.
 */
export interface ObservationAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  poll(): ChromiumObservation[];
}

const PROTOCOL_VERSION = '1.3';

/** CDP domains enabled for browser-observed console/runtime-error/network observation. */
export const CHROMIUM_DOMAINS = ['Page', 'Runtime', 'Network'] as const;

/** Bounded console history retained for the current active-tab observation session. */
export const CONSOLE_MAX_ENTRIES = 200;
/** Bounded runtime-error history retained for the current active-tab observation session. */
export const JSError_MAX_ENTRIES = 50;

/**
 * DEVPEEPER Chromium/CDP observer.
 *
 * Attaches to a single, browser-selected active tab through `chrome.debugger`,
 * enables only the minimal domain(s) needed to establish the observation
 * transport, and normalizes browser-issued events into DEVPEEPER observations
 * with preserved provenance.
 *
 * Scope is active-tab only: it does not enumerate or attach to every target,
 * worker, frame or background process. CDP is a product-security permission
 * decision; it is used here deliberately for browser-observed provenance.
 *
 * Browser identity is provenance, not durable source identity. There is no
 * `SourceIdentity` object and no source-rollover logic. The active-tab
 * attachment is the effective observation source.
 */
export class ChromiumObserver implements ObservationAdapter {
  private running = false;
  private readonly buffer: ChromiumObservation[] = [];
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly jsErrorEntries: JsErrorEntry[] = [];
  private readonly networkTracker = new NetworkTracker();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly target: DebuggerTarget;

  constructor(
    private readonly tabId: number,
    private readonly transport: DebuggerTransport,
  ) {
    this.target = { tabId };
  }

  /** The tab this observer is bound to (the active-tab attachment identity). */
  get attachedTabId(): number {
    return this.tabId;
  }

  async start(): Promise<void> {
    if (this.running) return;

    await this.transport.attach(this.target, PROTOCOL_VERSION);
    this.unsubscribers.push(
      this.transport.onEvent((source, method, params) =>
        this.handleEvent(source, method, params),
      ),
      this.transport.onDetach((source, reason) => this.handleDetach(source, reason)),
    );
    await this.transport.sendCommand(this.target, 'Page.enable');
    await this.transport.sendCommand(this.target, 'Runtime.enable');
    await this.transport.sendCommand(this.target, 'Network.enable');
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.clearSession();

    try {
      await this.transport.detach(this.target);
    } catch {
      // Chrome may have already detached the target (e.g. the tab closed or
      // DevTools was opened). Do not pretend the observer is still active.
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Bounded accumulated console history for the current active-tab session. */
  getConsoleEntries(): ConsoleEntry[] {
    return this.consoleEntries.slice();
  }

  /** Bounded accumulated runtime-error history for the current active-tab session. */
  getJsErrorEntries(): JsErrorEntry[] {
    return this.jsErrorEntries.slice();
  }

  /**
   * Bounded accumulated network history for the current active-tab session.
   * Finalizes any in-flight requests and fetches bounded response bodies for the
   * retained HTTP failures. A missing/failed body leaves the preview empty and
   * never drops the entry.
   */
  async getNetworkEntries(): Promise<NetworkEntry[]> {
    const { entries, needBody } = this.networkTracker.finalize();
    for (const requestId of needBody) {
      const entry = this.networkTracker.getEntryForRequest(requestId);
      if (!entry) continue;
      try {
        const result = await this.transport.sendCommand(
          this.target,
          'Network.getResponseBody',
          { requestId },
        );
        entry.responsePreview = decodeResponseBody(result as GetResponseBodyResult);
      } catch {
        // Body unavailable; keep the network entry with an empty preview.
      } finally {
        this.networkTracker.markBodyFetched(requestId);
      }
    }
    return entries.slice();
  }

  drain(): ChromiumObservation[] {
    if (this.buffer.length === 0) return [];
    return this.buffer.splice(0);
  }

  /** Alias kept for the passive observation contract. */
  poll(): ChromiumObservation[] {
    return this.drain();
  }

  private handleEvent(
    source: DebuggerTarget,
    method: string,
    params?: unknown,
  ): void {
    if (!this.accepts(source)) return;

    if (method === 'Network.requestWillBeSent') {
      this.networkTracker.onRequestWillBeSent(params as RequestWillBeSentParams);
    } else if (method === 'Network.responseReceived') {
      this.networkTracker.onResponseReceived(params as ResponseReceivedParams);
    } else if (method === 'Network.loadingFinished') {
      this.networkTracker.onLoadingFinished(params as LoadingFinishedParams);
    } else if (method === 'Network.loadingFailed') {
      this.networkTracker.onLoadingFailed(params as LoadingFailedParams);
    }

    const observation = this.normalize(method, params);
    if (!observation) return;

    this.buffer.push(observation);
    if (method === 'Runtime.consoleAPICalled') {
      const entry = normalizeConsoleApi(params as ConsoleApiParams);
      if (entry) this.pushConsole(entry);
    } else if (method === 'Runtime.exceptionThrown') {
      const entry = normalizeExceptionThrown(params as ExceptionThrownParams);
      if (entry) this.pushJsError(entry);
    }
  }

  private handleDetach(source: DebuggerTarget, _reason: string): void {
    if (!this.accepts(source)) return;
    // Chrome detached this session (tab closed, DevTools opened, etc.). The
    // observer is no longer active and stale buffered observations must not be
    // presented as if they were from a live session.
    this.running = false;
    this.clearSession();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  private accepts(source: DebuggerTarget): boolean {
    // Accept instrumentation only for the active attachment/session.
    return source != null && source.tabId === this.tabId;
  }

  private pushConsole(entry: ConsoleEntry): void {
    if (this.consoleEntries.length >= CONSOLE_MAX_ENTRIES) this.consoleEntries.shift();
    this.consoleEntries.push(entry);
  }

  private pushJsError(entry: JsErrorEntry): void {
    if (this.jsErrorEntries.length >= JSError_MAX_ENTRIES) this.jsErrorEntries.shift();
    this.jsErrorEntries.push(entry);
  }

  private clearSession(): void {
    this.buffer.length = 0;
    this.consoleEntries.length = 0;
    this.jsErrorEntries.length = 0;
    this.networkTracker.clear();
  }

  private normalize(method: string, params?: unknown): ChromiumObservation | null {
    if (method === 'Page.frameNavigated') {
      const frame = (params as { frame?: Record<string, unknown> } | undefined)?.frame ?? {};
      const provenance: ChromiumObservation['provenance'] = { tabId: this.tabId };

      const frameId = frame.id;
      if (typeof frameId === 'number') provenance.frameId = frameId;
      const loaderId = frame.loaderId;
      if (typeof loaderId === 'string') provenance.loaderId = loaderId;

      const paramsObj = params as { timestamp?: number } | undefined;
      if (typeof paramsObj?.timestamp === 'number') provenance.timestamp = paramsObj.timestamp;

      return {
        acquisition: 'chrome-debugger',
        method,
        payload: params,
        provenance,
      };
    }

    if (method === 'Runtime.consoleAPICalled') {
      const p = params as ConsoleApiParams | undefined;
      const provenance: ChromiumObservation['provenance'] = { tabId: this.tabId };
      if (typeof p?.executionContextId === 'number') {
        provenance.executionContextId = p.executionContextId;
      }
      if (typeof p?.timestamp === 'number') provenance.timestamp = p.timestamp;
      return {
        acquisition: 'chrome-debugger',
        method,
        payload: params,
        provenance,
      };
    }

    if (method === 'Runtime.exceptionThrown') {
      const p = params as ExceptionThrownParams | undefined;
      const details = p?.exceptionDetails;
      const provenance: ChromiumObservation['provenance'] = { tabId: this.tabId };
      if (typeof p?.executionContextId === 'number') {
        provenance.executionContextId = p.executionContextId;
      }
      if (typeof details?.scriptId === 'string') provenance.scriptId = details.scriptId;
      if (typeof p?.timestamp === 'number') provenance.timestamp = p.timestamp;
      return {
        acquisition: 'chrome-debugger',
        method,
        payload: params,
        provenance,
      };
    }

    if (
      method === 'Network.requestWillBeSent' ||
      method === 'Network.responseReceived' ||
      method === 'Network.loadingFinished' ||
      method === 'Network.loadingFailed'
    ) {
      const p = params as
        | RequestWillBeSentParams
        | ResponseReceivedParams
        | LoadingFinishedParams
        | LoadingFailedParams
        | undefined;
      const provenance: ChromiumObservation['provenance'] = { tabId: this.tabId };
      const requestId = p?.requestId;
      if (typeof requestId === 'string') provenance.requestId = requestId;
      const loaderId = (p as RequestWillBeSentParams)?.loaderId;
      if (typeof loaderId === 'string') provenance.loaderId = loaderId;
      const frameId = (p as RequestWillBeSentParams | ResponseReceivedParams)?.frameId;
      if (typeof frameId === 'number') provenance.frameId = frameId;
      const timestamp = p && ('timestamp' in p) ? p.timestamp : undefined;
      if (typeof timestamp === 'number') provenance.timestamp = timestamp;
      return {
        acquisition: 'chrome-debugger',
        method,
        payload: params,
        provenance,
      };
    }

    // Only recognized events are elevated to observations. Other browser events
    // are left for later DEVPEEPER milestones.
    return null;
  }
}
