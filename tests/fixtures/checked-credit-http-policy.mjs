// @ts-check
import {decodeCreditHttpReply,parseCreditJsonResponse,classifyCreditHttpResponse,parseRetryAfter} from '../../netunim-kupa/bank-bridge/credit-http-policy.mjs';
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
