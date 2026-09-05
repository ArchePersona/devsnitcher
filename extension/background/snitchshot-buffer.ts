/**
 * DEVSnitcher private SNITCHSHOT buffer.
 *
 * There is exactly one outstanding SNITCHSHOT globally across DEVSnitcher. It
 * lives in trusted extension session storage (`chrome.storage.session`,
 * restricted to trusted contexts), never in the page or the system clipboard.
 * It is the authoritative store for the owned paste lifecycle:
 *
 *   EMPTY → SNITCH succeeds → OCCUPIED → PASTE SNITCHSHOT succeeds → EMPTY
 *
 * No queue, no multiple buffered reports, no per-tab collection of pending
 * SNITCHSHOTs. The buffer is global: an occupied buffer blocks a new SNITCH
 * from every tab until it is consumed. It is cleared only after a successful
 * owned paste, never by tab switching or navigation.
 */

export interface SnitchshotRecord {
  /** The completed, redacted Markdown report. */
  report: string;
  /** The tab that created this SNITCHSHOT (lifecycle metadata only). */
  sourceTabId: number;
  /** Wall-clock creation time (lifecycle metadata only). */
  createdAt: number;
}

export const SNITCHSHOT_BUFFER_KEY = 'devsnitcher:snitchshot:v1';

export function isSnitchshotRecord(value: unknown): value is SnitchshotRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.report === 'string' &&
    v.report.length > 0 &&
    typeof v.sourceTabId === 'number' &&
    typeof v.createdAt === 'number'
  );
}

export interface SnitchshotStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SnitchshotBuffer {
  private readonly storage: SnitchshotStorageLike;

  constructor(storage: SnitchshotStorageLike) {
    this.storage = storage;
  }

  /** True when a SNITCHSHOT is outstanding (OCCUPIED). */
  async isOccupied(): Promise<boolean> {
    return (await this.peek()) !== null;
  }

  /**
   * Read the outstanding SNITCHSHOT, or null when the buffer is EMPTY. Reading
   * does not consume the record; only `clear` after a successful paste does.
   *
   * Storage READS are never collapsed into "EMPTY": a genuine read failure
   * throws so the caller surfaces it as an error instead of falsely reporting
   * an empty buffer (a private-buffer failure must not masquerade as absent).
   */
  async peek(): Promise<SnitchshotRecord | null> {
    const stored = await this.storage.get(SNITCHSHOT_BUFFER_KEY);
    const record = stored[SNITCHSHOT_BUFFER_KEY];
    return isSnitchshotRecord(record) ? record : null;
  }

  /**
   * Make `report` the outstanding SNITCHSHOT. Throws when the buffer is already
   * OCCUPIED so a new SNITCH can never silently replace a pending report.
   */
  async fill(report: string, sourceTabId: number): Promise<void> {
    if (typeof report !== 'string' || report.length === 0) {
      throw new Error('Rejected empty SNITCHSHOT report');
    }
    if (await this.isOccupied()) {
      throw new Error('SNITCHSHOT pending — paste it before taking another.');
    }
    const record: SnitchshotRecord = { report, sourceTabId, createdAt: Date.now() };
    await this.storage.set({ [SNITCHSHOT_BUFFER_KEY]: record });
  }

  /**
   * Clear the buffer after a successful owned paste. This is the authoritative
   * release; a failed removal throws so the caller does NOT send a false
   * CLIPBOARD_CLEARED confirmation and the SNITCHSHOT stays occupied.
   */
  async clear(): Promise<void> {
    await this.storage.remove(SNITCHSHOT_BUFFER_KEY);
  }
}