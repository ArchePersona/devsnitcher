import type { SnitchUiState } from '../../shared/types';

/**
 * Popup lifecycle state: the background-authoritative states plus the
 * popup-local transient `copying` transition (the OS clipboard write).
 */
export type PopupCtaState = SnitchUiState | 'copying';

export interface CtaConfig {
  /** Whether the SNITCH action is enabled and clickable. */
  snitchEnabled: boolean;
  /** Whether CANCEL is enabled (only valid while observing). */
  cancelEnabled: boolean;
  /** Whether COPY SNITCHSHOT is enabled (only when a report is pending). */
  copyEnabled: boolean;
  /** Whether the SNITCH configuration inputs are editable. */
  inputsEnabled: boolean;
  /** Contextual label under SNITCH. */
  snitchLabel: string;
  /** Contextual label under CANCEL. */
  cancelLabel: string;
  /** Contextual label under COPY SNITCHSHOT. */
  copyLabel: string;
}

/**
 * Deterministic single-projection of the lifecycle onto the three primary CTAs.
 *
 * All three CTAs stay rendered; the state only decides which are enabled and
 * what contextual label each shows, so the popup can never present two
 * contradictory "active" actions at the same time. This is the ONLY place the
 * population of the CTA configuration is derived — no separate UI bits are
 * allowed to disagree with it.
 *
 * Contract per background lifecycle:
 *
 *   IDLE              → only SNITCH enabled
 *   OBSERVING         → only CANCEL enabled
 *   SNITCHSHOT_PENDING→ only COPY SNITCHSHOT enabled
 *   COPYING (local)   → nothing enabled; COPY shows progress "Copying…"
 */
export function ctaConfig(state: PopupCtaState): CtaConfig {
  switch (state) {
    case 'idle':
      return {
        snitchEnabled: true,
        cancelEnabled: false,
        copyEnabled: false,
        inputsEnabled: true,
        snitchLabel: 'Ready',
        cancelLabel: 'Not observing',
        copyLabel: 'No report',
      };
    case 'observing':
      return {
        snitchEnabled: false,
        cancelEnabled: true,
        copyEnabled: false,
        inputsEnabled: false,
        snitchLabel: 'Watching…',
        cancelLabel: 'Stop observing',
        copyLabel: 'Not ready',
      };
    case 'snitchshot_pending':
      return {
        snitchEnabled: false,
        cancelEnabled: false,
        copyEnabled: true,
        inputsEnabled: false,
        snitchLabel: 'Report pending',
        cancelLabel: 'Not observing',
        copyLabel: 'Send report to clipboard',
      };
    case 'copying':
      return {
        snitchEnabled: false,
        cancelEnabled: false,
        copyEnabled: false,
        inputsEnabled: false,
        snitchLabel: 'Report pending',
        cancelLabel: 'Not observing',
        copyLabel: 'Copying…',
      };
  }
}