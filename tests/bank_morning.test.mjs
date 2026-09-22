import assert from 'node:assert/strict';
import {attachBankArchiveMetadata,bankMorningDebtCandidates,bankMorningEligibility,bankMorningPrefill} from '../netunim-orders/site/assets/js/domains/finance/bank-morning.js';
import {MORNING_BANKS,findMorningBanks,morningBankDatalistMarkup,resolveMorningBank} from '../netunim-orders/site/assets/js/domains/customers/morning-banks.js';
import {normalizeBankFeedTransaction} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {bankMorningActionCell,bankMorningChoiceMarkup,bankMorningLinkedDocumentsMarkup} from '../netunim-orders/site/assets/js/domains/finance/bank-morning-view.js';
import {bankTransferReferenceDetails} from '../netunim-orders/site/assets/js/domains/finance/bank-transaction-detail-view.js';
import {activeMorningBankDebts,morningBankDebtPickerMarkup} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-debt-picker.js';
import {morningBankTransactionLabel,morningBankTransactionPickerMarkup,morningLinkableBankTransactions} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-picker.js';
import {createCloudTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';

const row={archiveId:42,id:'k1',amount:1250,currency:'ILS',status:'completed',date:'2026-09-20T09:00:00Z',processedDate:'2026-09-20T09:00:00Z',partyName:'  משה   כהן ',description:'העברה',bankReference:'REF-7'};
assert.equal(bankMorningEligibility(row,'business').eligible,true);
assert.equal(bankMorningEligibility({...row,status:'pending'},'business').code,'pending');
assert.equal(bankMorningEligibility({...row,amount:-10},'business').code,'not-credit');
assert.equal(bankMorningEligibility({...row,currency:'USD'},'business').code,'currency');
assert.equal(bankMorningEligibility(row,'home').code,'home-account');
const prefill=bankMorningPrefill(row);assert.equal(prefill.customerName,'משה כהן');assert.equal(prefill.payment.price,1250);assert.equal(prefill.payment.type,4);assert.equal(prefill.payment.transactionId,'REF-7');assert.equal(prefill.source.bankTransactionId,42);assert.equal(prefill.source.paymentMode,'transfer');
assert.match(bankTransferReferenceDetails(row),/REF-7/,'ordinary bank transfers surface their stable bank reference in the movement view');
assert.match(bankTransferReferenceDetails({...row,checkDetails:{}}),/REF-7/,'an empty check-detail shell must not hide an ordinary transfer reference');
assert.equal(bankTransferReferenceDetails({...row,cheque:true,checkDetails:{kind:'deposit'}}),'','check movements keep their reference in the structured check detail block');

const detailedPrefill=bankMorningPrefill({...row,description:'זיכוי מהמזרחי',memo:'המבצע: · לקוח בדיקה · עבור: · הזמנה מח-ן:000123456',partyName:'לקוח בדיקה',partyHeadline:'המבצע:',messageHeadline:'עבור:',messageDetail:'הזמנה מח-ן:000123456'});
assert.equal(detailedPrefill.description,'זיכוי מהמזרחי · המבצע: · לקוח בדיקה · עבור: · הזמנה מח-ן:000123456','bank Morning prefill carries the full bank narrative into the document description without duplicating structured detail');
assert.equal(detailedPrefill.payment.bankCode,'20','Mizrahi is inferred from an explicit incoming-transfer description');
assert.equal(detailedPrefill.payment.bankName,'בנק מזרחי טפחות בע״מ');
assert.equal(detailedPrefill.payment.bankAccount,'000123456','leading zeroes in a bank account are preserved');
const explicitBankPrefill=bankMorningPrefill({...row,description:'זיכוי מהמזרחי',messageDetail:'מבנק 020,סניף 570 ,חשבון 000654321'});
assert.equal(explicitBankPrefill.payment.bankCode,'20');assert.equal(explicitBankPrefill.payment.bankBranch,'570');assert.equal(explicitBankPrefill.payment.bankAccount,'000654321');
assert.equal(resolveMorningBank('12')?.name,'בנק הפועלים בע״מ');assert.equal(resolveMorningBank('הפועלים')?.code,'12');assert.equal(findMorningBanks('12')[0]?.code,'12');assert.equal(findMorningBanks('פועל')[0]?.code,'12');
const bankOptions=morningBankDatalistMarkup();assert.match(bankOptions,/value="12 · בנק הפועלים בע״מ"/);assert.match(bankOptions,/value="12 · בנק הפועלים בע״מ" label="הפועלים · פועלים"/,'autocomplete keeps aliases searchable as compact secondary text on the single canonical bank option');assert.equal((bankOptions.match(/<option /g)||[]).length,MORNING_BANKS.length,'bank menu renders exactly one visible option per bank');assert.doesNotMatch(bankOptions,/value="פועלים"/,'bank aliases must not create duplicate visible menu rows');

const checkItems=[
  {bankNumber:'17',branchNumber:'725',accountNumber:'12345',checkNumber:'700001',amount:570},
  {bankNumber:'17',branchNumber:'725',accountNumber:'12345',checkNumber:'700002',amount:570},
  {bankNumber:'17',branchNumber:'725',accountNumber:'12345',checkNumber:'700003',amount:570},
];
const multiCheck={...row,archiveId:43,amount:1710,description:'הפק.שיק במכונה',bankReference:'-1',cheque:true,checkDetails:{kind:'deposit',checkCount:3,checkItems}};
assert.equal(bankMorningEligibility(multiCheck,'business').eligible,true);assert.equal(bankMorningEligibility(multiCheck,'business').aggregate,true);
const multiPrefill=bankMorningPrefill(multiCheck);assert.equal(multiPrefill.source.paymentMode,'checks');assert.equal(multiPrefill.source.bankCheckCount,3);assert.equal(multiPrefill.payment.length,3);assert.ok(multiPrefill.payment.every(payment=>payment.type===2&&payment.bankCode==='17'&&payment.bankName==='בנק מרכנתיל דיסקונט בע״מ'&&payment.removable===true));assert.equal(multiPrefill.payment.reduce((sum,payment)=>sum+payment.price,0),1710);
const singleCheck={...row,archiveId:44,amount:1000,description:'הפק.שיק בסלולר',bankReference:'20001',cheque:true,checkDetails:{kind:'deposit',checkCount:1,checkItems:[{bankNumber:'12',branchNumber:'655',accountNumber:'654321',checkNumber:'20001',amount:1000}]}};
const singlePrefill=bankMorningPrefill(singleCheck);assert.equal(singlePrefill.payment.length,1);assert.equal(singlePrefill.payment[0].type,2);assert.equal(singlePrefill.payment[0].bankCode,'12');assert.equal(singlePrefill.payment[0].removable,false);
assert.equal(bankMorningEligibility({...singleCheck,checkDetails:{...singleCheck.checkDetails,kind:'returned_credit'}},'business').code,'returned-cheque');
assert.equal(bankMorningEligibility({...multiCheck,amount:1700},'business').code,'check-details-mismatch');

const candidates=bankMorningDebtCandidates(row,[{id:'a',customerName:'משה כהן',amount:1250},{id:'b',customerName:'משה כהן בעמ',amount:900},{id:'c',customerName:'ישראל לוי',amount:1250},{id:'closed',customerName:'משה כהן',amount:1250,paid:true,invoiceIssued:true}]);
assert.deepEqual(candidates.map(x=>x.debtId),['a','b']);assert.ok(candidates[0].score>candidates[1].score);assert.match(candidates[0].reason,/יתרת התשלום תואמת/);
const partialCandidates=bankMorningDebtCandidates({...row,amount:1000},[{id:'partial',customerName:'משה כהן',amount:1250,debtProgress:[{id:'P1',kind:'payment',action:'add',amount:250,createdAt:'2026-09-01T00:00:00Z'}]}]);assert.equal(partialCandidates[0].remainingPayment,1000);assert.match(partialCandidates[0].reason,/יתרת התשלום תואמת/);
const pickerDebts=[{id:'a',customerName:'משה כהן',amount:1250,orderNumber:'A-15',phone:'0501234567',note:'מיטה לבנה'},{id:'b',customerName:'ישראל לוי',amount:900,orderNumber:'B-2'},{id:'closed',customerName:'סגור',amount:700,paid:true,invoiceIssued:true}];
assert.deepEqual(activeMorningBankDebts(pickerDebts).map(x=>x.id),['a','b'],'completed debts are absent from the bank debt picker');
const pickerMarkup=morningBankDebtPickerMarkup({debts:pickerDebts,transaction:row,activeDebtId:'',aggregate:false});
assert.match(pickerMarkup,/חפש לקוח, הזמנה, טלפון או הערה/);assert.match(pickerMarkup,/התאמה מועדפת/);assert.match(pickerMarkup,/data-bank-debt-search="ישראל לוי b-2"/);assert.match(pickerMarkup,/<button type="button" class="morning-bank-debt-row[^>]*data-action="morning-bank-debt-select"[^>]*data-click-arg0="b"/,'the entire debt result row is the selection control');assert.doesNotMatch(pickerMarkup,/>בחר</,'bank debt results do not waste a separate action column on a choose button');assert.doesNotMatch(pickerMarkup,/id="morningBankDebtLink"/);
const transactionPickerRows=morningLinkableBankTransactions([row,{...row,archiveId:45,status:'pending'},{...row,archiveId:46,amount:-2}]);assert.deepEqual(transactionPickerRows.map(item=>item.archiveId),[42],'reverse bank picker exposes only finalized eligible credits');
const transactionPicker=morningBankTransactionPickerMarkup({});assert.match(transactionPicker,/קישור לתנועת בנק/);assert.match(transactionPicker,/חפש לפי לקוח, פעולה, אסמכתא, תאריך או סכום/);assert.match(transactionPicker,/morning-bank-transaction-select/);assert.match(morningBankTransactionLabel(row),/משה כהן/);assert.match(morningBankTransactionLabel(row),/1,250/);
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
const existing=bankMorningChoiceMarkup(normalized);assert.match(existing.body,/כבר הופק מסמך מאומת/);assert.match(existing.body,/morning-open-document/);const inlineLinks=bankMorningLinkedDocumentsMarkup(normalized);assert.match(inlineLinks,/חשבונית מס \/ קבלה 1007/);assert.match(inlineLinks,/data-action="morning-open-document"/,'verified Morning documents are directly viewable from the bank row');
console.log('bank morning tests passed');
