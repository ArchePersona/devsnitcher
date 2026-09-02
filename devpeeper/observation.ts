import type { BoundedSnapshot } from './snapshot-probe';
import type { DomContext, EnvironmentInfo } from '../shared/types';

/**
 * DEVPEEPER observation envelope.
 *
 * A DEVPEEPER observation keeps three things distinct:
 * - `payload`: the bounded observation itself;
 * - `acquisition`: which mechanism obtained it;
 * - `provenance`: browser-issued identity for where/when it was observed.
 *
 * Acquisition mechanisms are kept distinct by assurance level and must never be
 * collapsed into one undifferentiated label:
 * - `chrome-scripting`: browser-returned via `chrome.scripting.executeScript` →
 *   Chrome `InjectionResult`.
 * - `chrome-debugger`: browser-observed via Chromium/CDP instrumentation →
 *   extension/DEVPEEPER.
 *
 * Page-reported evidence (MAIN-world hook → page-mediated transport) belongs to
 * neither mechanism and is never labeled browser-authenticated.
 */
export type ObservationAcquisition = 'chrome-scripting' | 'chrome-debugger';

export interface ObservationAdapter<O = ChromiumObservation> {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  poll(): O[];
}

/**
 * Browser-issued provenance for Chromium/CDP-originated observations.
 *
 * These fields are preserved verbatim when Chrome supplies them. They are
 * provenance, not a durable source identity. DEVPEEPER does not collapse them
 * into one synthetic `source_id`, and it never invents values Chrome did not
 * provide.
 */
export interface ChromiumObservationProvenance {
  tabId: number;
  targetId?: string;
  frameId?: number;
  documentId?: string;
  loaderId?: string;
  executionContextId?: number;
  scriptId?: string;
  requestId?: string;
  timestamp?: number;
}

/**
 * A browser-observed observation delivered through Chromium instrumentation.
 *
 * `method` names the CDP method (e.g. `Page.frameNavigated`); `payload` is the
 * raw browser-issued params; `provenance` carries the preserved browser
 * identifiers. `acquisition` is `'chrome-debugger'`, distinct from the
 * `'chrome-scripting'` bounded probe mechanism.
 */
export interface ChromiumObservation {
  acquisition: 'chrome-debugger';
  method: string;
  payload: unknown;
  provenance: ChromiumObservationProvenance;
}

export interface BoundedObservationProvenance {
  tabId: number;
  frameId?: number;
  documentId?: string;
  worldId?: number;
}

export interface BoundedObservationPayload {
  environment: EnvironmentInfo;
  dom: DomContext | null;
}

export interface BoundedObservation {
  acquisition: ObservationAcquisition;
  payload: BoundedObservationPayload;
  provenance: BoundedObservationProvenance;
}

/**
 * Minimal structural view of the browser-issued fields Chrome returns on an
 * `InjectionResult`. Kept local so normalization is testable without Chrome.
 * Only browser-supplied identities are carried; nothing is invented.
 */
export interface InjectionResultLike {
  frameId?: number;
  documentId?: string;
  worldId?: number;
}

/** Maps a Chrome-mediated bounded snapshot into the DEVSnitcher evidence shapes. */
export function normalizeBoundedSnapshot(
  snapshot: BoundedSnapshot,
  timestamp: number,
): BoundedObservationPayload {
  return {
    environment: { ...snapshot.environment, timestamp },
    dom: snapshot.dom,
  };
}

/**
 * Builds the DEVPEEPER observation envelope for a Chrome-scripting acquisition.
 *
 * `tabId` is the tab the extension targeted on the request path; `frameId`,
 * `documentId` and `worldId` are browser-issued and only present when Chrome
 * supplies them.
 */
export function makeBoundedObservation(
  snapshot: BoundedSnapshot,
  result: InjectionResultLike,
  tabId: number,
  timestamp: number,
): BoundedObservation {
  return {
    acquisition: 'chrome-scripting',
    payload: normalizeBoundedSnapshot(snapshot, timestamp),
    provenance: {
      tabId,
      ...(result.frameId !== undefined ? { frameId: result.frameId } : {}),
      ...(result.documentId ? { documentId: result.documentId } : {}),
      ...(result.worldId !== undefined ? { worldId: result.worldId } : {}),
    },
  };
}
