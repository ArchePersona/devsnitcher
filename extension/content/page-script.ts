import { collectDevPeeperEvidence, startDevPeeper } from '../../devpeeper';
import type { SnitchMessage } from '../../shared/types';

startDevPeeper();

window.addEventListener('message', (ev: MessageEvent) => {
  const source = ev.source;
  if (source !== window) return;
  const data = ev.data as SnitchMessage | undefined;
  if (!data || typeof data !== 'object' || !('type' in data)) return;
  if ((data as SnitchMessage).type !== 'COLLECT_EVIDENCE') return;

  const reply: SnitchMessage = {
    type: 'EVIDENCE_RESULT',
    evidence: collectDevPeeperEvidence(),
  };
  window.postMessage(reply, '*');
});
