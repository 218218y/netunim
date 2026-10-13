import { clone } from '../../core/values.js';
import { normalizeCashflowSettings } from '../../shared/cashflow.js';

export function prepareKupaWriteState(kupa) {
  const out = clone(kupa || {});
  delete out.creditSync;
  out.cashflowSettings = normalizeCashflowSettings(out.cashflowSettings);
  const bank = out.bank && typeof out.bank === 'object' ? out.bank : {};
  out.bank = {
    currentBalance: bank.source === 'manual' ? bank.currentBalance : null,
    updatedAt: bank.source === 'manual' ? bank.updatedAt : null,
    asOfDate: bank.source === 'manual' ? bank.asOfDate : null,
    adjustments: Array.isArray(bank.adjustments)
      ? bank.adjustments.filter((x) => x?.type !== 'check_deposit')
      : [],
    source: bank.source === 'manual' ? 'manual' : null,
    sourceAccount: null,
    snapshotToken: bank.snapshotToken ?? null,
    snapshotSeq: bank.snapshotSeq ?? null,
  };
  return out;
}
