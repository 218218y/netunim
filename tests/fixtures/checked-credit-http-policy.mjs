// @ts-check
import {decodeCreditHttpReply,parseCreditJsonResponse,classifyCreditHttpResponse,parseRetryAfter} from '../../netunim-kupa/bank-bridge/credit-http-policy.mjs';
import {maxGetJsonWithinPage,postVisaCalJson} from '../../netunim-kupa/bank-bridge/credit-http.mjs';
import {sleep} from '../../netunim-kupa/bank-bridge/credit-scheduler.mjs';
import {genericMonthlyAccount} from '../../netunim-kupa/bank-bridge/credit-monthly-projection.mjs';
/** @type {unknown} */
const external={status:200,body:'{"amount":"unvalidated"}',retryAfter:''};
const reply=decodeCreditHttpReply(external,'Frames');
reply.status.toFixed();reply.body.toUpperCase();reply.retryAfter.toUpperCase();
const payload=parseCreditJsonResponse(reply.body,{status:reply.status,stage:'Frames'});
// @ts-expect-error HTTP/JSON decoding cannot certify an issuer data shape or amount
payload.amount.toFixed();
// @ts-expect-error numeric status cannot masquerade as text
reply.status.toUpperCase();
// @ts-expect-error a parsed domain object cannot skip the wire-text boundary
parseCreditJsonResponse({amount:20},{status:200});
// @ts-expect-error caller reference time is epoch milliseconds, not a display date
parseRetryAfter('5','2026-10-25');
const failure=classifyCreditHttpResponse({status:429,text:'not retained',stage:'Transactions'});
failure?.httpStatus.toFixed();failure?.stage.toUpperCase();
// @ts-expect-error classification cannot certify a provider balance
failure?.balance.toFixed();

const page = {evaluate: async () => ({status:200,body:'{}',retryAfter:''})};
postVisaCalJson(page, fetch, 'https://fixture.invalid', {}).then(result => {
  if (result.transport === 'node-fallback') result.browserError.toLowerCase();
  // @ts-expect-error provider JSON needs its decoder before reading an amount
  result.data.amount;
});
maxGetJsonWithinPage(page, 'https://fixture.invalid', 'fixture', Date.now(), event => {
  // @ts-expect-error network/invalid-transport diagnostics have no response body
  event.data;
});
// @ts-expect-error transport and scheduling budgets are milliseconds, not strings
postVisaCalJson(page, fetch, 'https://fixture.invalid', {}, {timeoutMs:'1000'});
// @ts-expect-error provider pacing receives a numeric budget
sleep('650');
// @ts-expect-error the monthly writer receives a validated Date clock
genericMonthlyAccount({},'max',{startDate:'2026-11-01',futureMonths:1,now:'2026-11-18'});
