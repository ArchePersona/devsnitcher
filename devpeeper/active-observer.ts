import { ChromiumObserver } from './chromium';
import type { DebuggerTransport } from './debugger-transport';

/**
 * Owns the single active-tab Chromium observer and serializes its start/stop
 * transitions so concurrent activation events cannot overlap in-flight
 * attach/detach and leak multiple debugger sessions.
 *
 * Before this controller, `chromiumObserver` was reassigned *before* the new
 * observer's `start()` finished, while `isRunning()` was still false, so a
 * second activation could create another observer without stopping the first.
 * Chaining every transition on a single promise guarantees only one transition
 * runs at a time, the tracked observer is always the actual (last) live one,
 * and a superseded or failed observer is never left attached.
 *
 * This is intentionally a narrow serialization point, not a general scheduler
 * or queue. It never observes more than the active tab.
 */
export class ActiveTabObserverController {
  private observer: ChromiumObserver | null = null;
  private transition: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: () => DebuggerTransport,
    private readonly isSupported: (url: string) => boolean,
  ) {}

  /** The tab id the current observer is bound to, or undefined when none is live. */
  get attachedTabId(): number | undefined {
    return this.observer?.attachedTabId;
  }

  isRunning(): boolean {
    return this.observer?.isRunning() ?? false;
  }

  /**
   * Returns the live observer bound to `tabId`, or null when none is live for
   * that tab (so evidence from a replaced or invalidated attachment is never
   * reused).
   */
  liveFor(tabId: number): ChromiumObserver | null {
    if (this.observer?.isRunning() && this.observer.attachedTabId === tabId) {
      return this.observer;
    }
    return null;
  }

  /** Serialized transition to follow `tab` as the active tab. */
  async follow(tab: { id?: number; url?: string }): Promise<void> {
    this.transition = this.transition.then(
      () => this.runFollow(tab),
      () => this.runFollow(tab),
    );
    return this.transition;
  }

  /** Serialized transition to stop the observer when its tab is removed. */
  async handleRemoved(tabId: number): Promise<void> {
    this.transition = this.transition.then(
      () => this.runRemoved(tabId),
      () => this.runRemoved(tabId),
    );
    return this.transition;
  }

  private async runFollow(tab: { id?: number; url?: string }): Promise<void> {
    // Browser-internal/unsupported pages are excluded from observation. If the
    // active tab is unsupported, detach any current observer rather than observe it.
    if (!tab.id || !tab.url || !this.isSupported(tab.url)) {
      if (this.observer?.isRunning()) {
        await this.observer.stop();
      }
      this.observer = null;
      return;
    }

    const tabId = tab.id;
    if (this.observer?.isRunning() && this.observer.attachedTabId === tabId) return;

    if (this.observer?.isRunning()) {
      await this.observer.stop();
      this.observer = null;
    }

    const observer = new ChromiumObserver(tabId, this.transport());
    this.observer = observer;
    try {
      await observer.start();
    } catch (error) {
      // Failed startup must not leave an untracked observer: dropping the
      // reference here guarantees `this.observer` is always the live observer.
      // `ChromiumObserver.start` is transactional, so nothing leaks on failure.
      if (this.observer === observer) this.observer = null;
      throw error;
    }
  }

  private async runRemoved(tabId: number): Promise<void> {
    if (this.observer?.attachedTabId === tabId) {
      await this.observer.stop();
      this.observer = null;
    }
  }
}
