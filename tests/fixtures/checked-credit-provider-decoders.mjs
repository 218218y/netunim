// @ts-check
import { extractMaxTransactionCandidates, normalizeMaxRawTransaction } from '../../netunim-kupa/bank-bridge/max-model.mjs';
import { parseVisaCalFrame, parseVisaCalMonthData } from '../../netunim-kupa/bank-bridge/visa-cal-model.mjs';

/** @param {unknown} payload */
export function readProviderEvidence(payload) {
  const max = extractMaxTransactionCandidates(payload);
  const maxRow = max.transactions[0];
  const charge = maxRow && normalizeMaxRawTransaction(maxRow)?.chargedAmount;
  const cal = parseVisaCalMonthData(payload);
  const balance = parseVisaCalFrame(payload).balance;
  // @ts-expect-error raw transaction fields need decoding
  maxRow?.actualPaymentAmount.toFixed(2);
  // @ts-expect-error a frame can be unavailable
  balance.toFixed(2);
  // @ts-expect-error wire options are checked independently of the unknown response
  parseVisaCalMonthData(payload, { startDate: 10 });
  return { charge, balance, cal };
}
