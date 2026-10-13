import { createDomainsBankController } from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import { createKupaBankArchiveReadout } from '../netunim-kupa/site/assets/js/domains/bank/archive-readout.js';
import { bankArchiveTargets } from '../netunim-kupa/site/assets/js/domains/bank/archive-model.js';

// Explicit test ports route the actual archive owner. No production legacy API.
export function createKupaBankControllerFixture(ports) {
  if (
    typeof ports.autoScope !== 'function' ||
    typeof ports.operationScope?.capture !== 'function' ||
    typeof ports.operationScope?.captureRead !== 'function'
  )
    return createDomainsBankController(ports);
  const archive = createKupaBankArchiveReadout({
    authority: ports.operationScope,
    sources: { targets: () => bankArchiveTargets(ports.model.state.bank || {}) },
    reads: {
      transactions: ports.readBankTransactions ?? (async () => []),
      snapshot: ports.readBankTransactionSnapshot ?? (async () => null),
    },
    access: { cloud: () => ports.session.connectionMode === 'supabase' },
    publication: () => {
      ports.touchBankDisplayRevision?.();
      ports.render?.();
    },
    report: (role, error) => console.error(`bank display archive ${role}`, error),
  });
  const controller = createDomainsBankController({ ...ports, archive }),
    runtime = controller.runtime;
  return {
    ...controller,
    runtime: {
      async drain() {
        await runtime.drain();
        await archive.runtime.drain();
      },
      dispose() {
        const result = runtime.dispose();
        archive.runtime.dispose();
        return result;
      },
    },
  };
}
