import assert from 'node:assert/strict';
import {attachBankArchiveMetadata,bankMorningDebtCandidates,bankMorningEligibility,bankMorningPrefill} from '../netunim-orders/site/assets/js/domains/finance/bank-morning.js';
import {normalizeBankFeedTransaction} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {bankMorningActionCell,bankMorningChoiceMarkup} from '../netunim-orders/site/assets/js/domains/finance/bank-morning-view.js';
import {createCloudTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';

const row={archiveId:42,id:'k1',amount:1250,currency:'ILS',status:'completed',date:'2026-09-20T09:00:00Z',processedDate:'2026-09-20T09:00:00Z',partyName:'  משה   כהן ',description:'העברה',bankReference:'REF-7'};
assert.equal(bankMorningEligibility(row,'business').eligible,true);
assert.equal(bankMorningEligibility({...row,status:'pending'},'business').code,'pending');
assert.equal(bankMorningEligibility({...row,amount:-10},'business').code,'not-credit');
assert.equal(bankMorningEligibility({...row,currency:'USD'},'business').code,'currency');
assert.equal(bankMorningEligibility(row,'home').code,'home-account');
const prefill=bankMorningPrefill(row);assert.equal(prefill.customerName,'משה כהן');assert.equal(prefill.payment.price,1250);assert.equal(prefill.payment.type,4);assert.equal(prefill.payment.transactionId,'REF-7');assert.equal(prefill.source.bankTransactionId,42);
const candidates=bankMorningDebtCandidates(row,[{id:'a',customerName:'משה כהן',amount:1250},{id:'b',customerName:'משה כהן בעמ',amount:900},{id:'c',customerName:'ישראל לוי',amount:1250},{id:'closed',customerName:'משה כהן',amount:1250,paid:true,invoiceIssued:true}]);
assert.deepEqual(candidates.map(x=>x.debtId),['a','b']);assert.ok(candidates[0].score>candidates[1].score);assert.match(candidates[0].reason,/יתרת התשלום תואמת/);
const partialCandidates=bankMorningDebtCandidates({...row,amount:1000},[{id:'partial',customerName:'משה כהן',amount:1250,debtProgress:[{id:'P1',kind:'payment',action:'add',amount:250,createdAt:'2026-09-01T00:00:00Z'}]}]);assert.equal(partialCandidates[0].remainingPayment,1000);assert.match(partialCandidates[0].reason,/יתרת התשלום תואמת/);
assert.equal(bankMorningEligibility({...row,checkDetails:{checkCount:2,checkItems:[{},{}]}},'business').aggregate,true);
const direct=attachBankArchiveMetadata([{id:'k1',amount:1250}],[{archiveId:42,id:'k1',handledAt:'2026-09-21T00:00:00Z'}]);assert.equal(direct[0].archiveId,42);assert.ok(direct[0].handledAt);

const response=body=>({ok:true,async json(){return body},async text(){return JSON.stringify(body)}});
const transport=createCloudTransport({supaFetch:async(path)=>{
  if(path.includes('/bank_transactions?'))return response([{id:42,merge_key:'k1',transaction_date:row.date,processed_date:row.processedDate,amount:'1250',currency:'ILS',description:'העברה',memo:'',party_name:'משה כהן',party_headline:'',message_headline:'',message_detail:'',status:'completed',balance_after:null,bank_reference:'REF-7',bank_serial:'',activity_type_code:null,cheque:false,check_details:null,credit_settlement_details:null,first_seen_at:row.date,presence_state:'present',last_seen_at:row.date,missing_since:null,missing_acknowledged_at:null,alert_acknowledgements:{},handled_at:'2026-09-21T00:00:00Z'}]);
  if(path.includes('/rpc/list_bank_morning_document_links'))return response([{transaction_id:42,link_id:9,operation_id:'123e4567-e89b-42d3-a456-426614174000',document_id:'123e4567-e89b-42d3-a456-426614174001',document_number:'1007',document_type:320,document_amount:'1250',verified_at:'2026-09-21T01:00:00Z'}]);
  throw new Error('unexpected '+path);
}});
const archived=(await transport.readBankTransactions('12-345-1','business',{days:null,maxRows:1000}))[0];assert.ok(archived.handledAt);assert.equal(archived.documentLinks[0].documentNumber,'1007');

const normalized=normalizeBankFeedTransaction({...row,handledAt:'2026-09-21T00:00:00Z',documentLinks:[{linkId:9,operationId:'123e4567-e89b-42d3-a456-426614174000',documentId:'123e4567-e89b-42d3-a456-426614174001',documentNumber:'1007',documentType:320,documentAmount:1250,verifiedAt:'2026-09-21T01:00:00Z'}]});
assert.ok(normalized.handledAt,'bank normalization must preserve the durable handled marker');
assert.equal(normalized.documentLinks.length,1,'bank normalization must preserve verified Morning links');
assert.match(bankMorningActionCell(normalized,'business'),/handled active/,'handled bank row stays visibly green after normalization');
assert.match(bankMorningActionCell(normalized,'business'),/create-document linked/,'a verified linked document is surfaced on the + action');
const existing=bankMorningChoiceMarkup(normalized);assert.match(existing.body,/כבר הופק מסמך מאומת/);assert.match(existing.body,/morning-open-document/);
console.log('bank morning tests passed');
