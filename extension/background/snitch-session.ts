import type { ConsoleEntry, DomContext, EnvironmentInfo, Evidence, JsErrorEntry, NetworkEntry, ScreenshotInfo } from '../../shared/types';
import { ChromiumObserver } from '../../devpeeper/chromium';
import type { DebuggerTransport } from '../../devpeeper/debugger-transport';

/**
 * DEVSnitcher bounded SNITCH session.
 *
 * DEVPEEPER does nothing until the user presses SNITCH. Pressing SNITCH starts
 * exactly one observation session bound to the tab selected at that moment.
 * The source tab is immutable: switching tabs never moves, restarts or
 * resurrects the session, and tab activation is never session authority.
 *
 * The session attaches a single Chromium observer (`chrome.debugger`), acquires
 * the bounded contextual fields (environment/DOM), then collects the
 * browser-observed console/runtime-error/network surfaces until each one is
 * complete. A surface is complete when it has produced qualifying evidence OR
 * the bounded harvest window has elapsed (an empty result is a legitimate
 * result; we never wait indefinitely for an error to occur). When every surface
 * is complete the session assembles the evidence, asks the coordinator to
 * redact/build/store the report, detaches the debugger, and becomes idle.
 *
 * Cancellation is terminal: it detaches the debugger, discards the unfinished
 * session and never resurrects it. There is at most one live session globally.
 *
 * This module is deliberately free of `chrome.*` so the lifecycle can be tested
 * against injected collaborators (transport, clock, scheduler, evidence hooks).
 */
export interface SnitchSessionContext {
  tabId: number;
  tabUrl: string;
  windowId?: number;
  userNotes: string;
  screenshot: boolean;
  screenshotInfo?: ScreenshotInfo;
}

/** The bounded contextual fields required by the report, from the snapshot probe. */
export interface SnitchBoundedContext {
  environment: EnvironmentInfo;
  dom: DomContext | null;
}

export interface SnitchSessionDeps {
  transport: () => DebuggerTransport;
  isSupported: (url: string) => boolean;
  /** Acquires environment + DOM for the session tab (browser-observed bounded probe). */
  acquireBounded(tabId: number): Promise<SnitchBoundedContext>;
  /** Monotonic-ish clock in ms used for the harvest window. */
  now(): number;
  /** Schedules the completion poll; returns a stop function. */
  scheduleTick(cb: () => void, ms: number): () => void;
  /**
   * Called once when the session's required evidence surfaces are complete with
   * the fully assembled evidence. The coordinator redacts, builds the report and
   * fills the private SNITCHSHOT buffer here. The debugger detaches afterward.
   */
  onComplete(evidence: Evidence, ctx: SnitchSessionContext): Promise<void>;
  /** Called on CANCEL / removal after the debugger detaches. Best-effort. */
  onCancel?(ctx: SnitchSessionContext): void | Promise<void>;
}

/** How long the session stays attached collecting browser-observed evidence. */
export const HARVEST_WINDOW_MS = 6000;
/** Cadence for the completion poll. */
export const SESSION_POLL_MS = 300;

interface Seen {
  console: boolean;
  jsErrors: boolean;
  network: boolean;
}

export class SnitchSessionManager {
  private observer: ChromiumObserver | null = null;
  private ctx: SnitchSessionContext | null = null;
  private startTime = 0;
  private seen: Seen = { console: false, jsErrors: false, network: false };
  private bounded: SnitchBoundedContext | null = null;
  private boundedComplete = false;
  private stopPoll: (() => void) | null = null;
  private lastError: string | null = null;

  constructor(private readonly deps: SnitchSessionDeps) {}

  /** True while a SNITCH observation session is live. */
  isObserving(): boolean {
    return this.observer?.isRunning() ?? false;
  }

  /** The immutable tab id currently bound, or undefined when idle. */
  attachedTabId(): number | undefined {
    return this.observer?.attachedTabId;
  }

  /** Last session error (non-fatal status detail), or null. */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Starts a SNITCH session on `ctx`'s tab. Resolves `true` when the session
   * began observing; `false` when one is already live (global active gate).
   * Throws when startup fails (e.g. unsupported tab or debugger attach error);
   * the caller reports the error and returns to idle.
   */
  async start(ctx: SnitchSessionContext): Promise<boolean> {
    if (this.isObserving()) return false;
    if (!ctx.tabId || !this.deps.isSupported(ctx.tabUrl)) {
      throw new Error('DEVSnitcher cannot inspect this tab.');
    }

    const observer = new ChromiumObserver(ctx.tabId, this.deps.transport());
    await observer.start();
    this.observer = observer;
    this.ctx = ctx;
    this.startTime = this.deps.now();
    this.seen = { console: false, jsErrors: false, network: false };
    this.bounded = null;
    this.boundedComplete = false;
    this.lastError = null;

    // Acquire the bounded contextual fields for the session tab, browser-observed.
    void this.deps
      .acquireBounded(ctx.tabId)
      .then((bounded) => {
        this.bounded = bounded;
        this.boundedComplete = true;
      })
      .catch(() => {
        this.bounded = null;
        this.boundedComplete = true;
      });

    this.stopPoll = this.deps.scheduleTick(() => void this.tick(), SESSION_POLL_MS);
    return true;
  }

  /**
   * Cancellation is terminal: detaches the debugger, discards the unfinished
   * session and clears all live state. Resolves `true` when a live session was
   * canceled, `false` when there was nothing to cancel.
   */
  async cancel(): Promise<boolean> {
    const observer = this.observer;
    if (!observer) return false;

    // Clear live state synchronously so no later tick/activation can resurrect it.
    const ctx = this.ctx;
    this.observer = null;
    this.ctx = null;
    if (this.stopPoll) this.stopPoll();
    this.stopPoll = null;

    await observer.stop().catch(() => undefined);
    this.resetSeen();
    if (ctx && this.deps.onCancel) {
      await Promise.resolve(this.deps.onCancel(ctx)).catch(() => undefined);
    }
    return true;
  }

  /** Detach the live session when its source tab is removed (no migration). */
  async handleRemoved(tabId: number): Promise<void> {
    if (this.observer?.attachedTabId === tabId) {
      await this.cancel();
    }
  }

  /** Completion poll (driven by the scheduler; public for deterministic tests). */
  async tick(): Promise<void> {
    const observer = this.observer;
    if (!observer) return;
    if (this.seenChange(observer)) this.markSeen(observer);

    const elapsed = this.deps.now() - this.startTime;
    const windowElapsed = elapsed >= HARVEST_WINDOW_MS;
    const allDevToolsDone = windowElapsed || (this.seen.console && this.seen.jsErrors && this.seen.network);

    if (!this.boundedComplete || !allDevToolsDone) return;
    await this.finalize(observer);
  }

  private seenChange(observer: ChromiumObserver): boolean {
    return (
      observer.getConsoleEntries().length > 0 ||
      observer.getJsErrorEntries().length > 0 ||
      observer.hasNetworkEntries()
    );
  }

  private markSeen(observer: ChromiumObserver): void {
    if (observer.getConsoleEntries().length > 0) this.seen.console = true;
    if (observer.getJsErrorEntries().length > 0) this.seen.jsErrors = true;
    if (observer.hasNetworkEntries()) this.seen.network = true;
  }

  private async finalize(observer: ChromiumObserver): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.stopPoll) this.stopPoll();
    this.stopPoll = null;

    const environment = this.bounded?.environment;

    if (!environment) {
      // The bounded contextual fields failed to acquire; this cannot satisfy the
      // report contract, so fail the session and detach without producing a report.
      this.lastError = 'DEVPEEPER could not acquire the bounded page context.';
      return this.teardown(observer);
    }

    // Clear live state before the coordinator stores the report so a concurrent
    // cancel/tick sees an idle manager and never resurrects a completing session.
    this.observer = null;
    this.ctx = null;

    try {
      const evidence = await this.assembleEvidence(observer, environment, ctx);
      await this.deps.onComplete(evidence, ctx);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    // Always detach once the report has been attempted/stored; the debugger must
    // not remain attached after the session resolves, succeed or not.
    return this.teardown(observer);
  }

  private async teardown(observer: ChromiumObserver): Promise<void> {
    this.observer = null;
    this.ctx = null;
    await observer.stop().catch(() => undefined);
    this.resetSeen();
  }

  private async assembleEvidence(
    observer: ChromiumObserver,
    environment: EnvironmentInfo,
    ctx: SnitchSessionContext,
  ): Promise<Evidence> {
    const console: ConsoleEntry[] = observer.getConsoleEntries();
    const jsErrors: JsErrorEntry[] = observer.getJsErrorEntries();
    const network: NetworkEntry[] = await observer.getNetworkEntries();
    const dom = this.bounded?.dom ?? null;
    return {
      environment,
      console,
      jsErrors,
      network,
      dom,
      screenshot: ctx.screenshotInfo ?? null,
    };
  }

  private resetSeen(): void {
    this.seen = { console: false, jsErrors: false, network: false };
    this.bounded = null;
    this.boundedComplete = false;
    this.startTime = 0;
  }
}