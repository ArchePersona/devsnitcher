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
 * No generic adapter abstraction is introduced here: this is the single,
 * Chrome-scripting-mediated acquisition path DEVPEEPER currently needs.
 */
export type ObservationAcquisition = 'chrome-scripting';

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
