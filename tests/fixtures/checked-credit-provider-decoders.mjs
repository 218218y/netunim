// @ts-check
import { extractMaxTransactionCandidates, normalizeMaxRawTransaction } from '../../netunim-kupa/bank-bridge/max-model.mjs';
import { parseVisaCalFrame, parseVisaCalMonthData } from '../../netunim-kupa/bank-bridge/visa-cal-model.mjs';
import { MaxAdapter } from '../../netunim-kupa/bank-bridge/max-adapter.mjs';
import { safeMaxResponseEvidence } from '../../netunim-kupa/bank-bridge/max-response-diagnostics.mjs';

/** @type {import('../../netunim-kupa/bank-bridge/max-adapter.mjs').MaxAdapterOptions} */
const fixture = {
  profile:{profileId:'P',provider:'max',label:'Fixture',ownerLabel:'',defaultAccount:'ביתי',active:true,credentials:{}},
  companyId:'max',createScraper:()=>({initialize:async()=>{},login:async()=>({success:true}),terminate:async()=>{}}),
};
new MaxAdapter(fixture).scrape().then(result => {
  if (result.coreComplete) result.syncedAt.toUpperCase();
  // @ts-expect-error callers must read coverage evidence before assuming a timestamp is present
  result.syncedAt.toUpperCase();
});
// @ts-expect-error the scraper must provide a completion promise for the browser lifecycle
new MaxAdapter({...fixture,createScraper:()=>({initialize:async()=>{},login:async()=>({success:true}),terminate:()=>true})});
// @ts-expect-error sanitized evidence is numerical metadata, not a string HTTP status
safeMaxResponseEvidence({})?.httpStatus.toUpperCase();

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
