import test from 'node:test';
import assert from 'node:assert/strict';
import {readBankTransaction} from '../shared/bank-transaction-evidence.js';
import {readBankBalanceResult} from '../shared/bank-balance-result.js';
import {readBankArchiveRows,readBankSnapshotRows} from '../shared/bank-response-records.js';
import {normalizeHapoalimTransaction} from '../netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs';
import {normalizeBankFeedTransaction as ordersFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {normalizeBankFeedTransaction as kupaFeed} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
const at='2026-10-16T10:00:00Z';
const tx={id:'T',mergeKey:'T',date:at,amount:20,currency:'ILS',status:'completed'};
const check={kind:'deposit',checkCount:1,checkNumbers:['123'],hasDocumentReference:false,
  checkItems:[{checkNumber:'123',amount:20,hasDocumentReference:false,imageFrontKey:'a'.repeat(64)}]};
const settlement={provider:'max',cardLast4s:['1234'],cardIdentitySource:'bank_detail_explicit',detailFetched:true};
const archive={id:1,account_key:'A',account_role:'business',merge_key:'T',amount:20,currency:'ILS',status:'completed',
  first_seen_at:at,transaction_date:at,processed_date:null,last_seen_at:null,missing_since:null,missing_acknowledged_at:null,
  presence_state:'present',alert_acknowledgements:{},cheque:true,balance_after:null};
const snapshot={account_key:'A',account_role:'business',snapshot_at:at,coverage_from:'2026-10-01',coverage_to:'2026-10-16',transaction_count:1};
for(const [field,sqlField,values] of [
  ['checkDetails','check_details',[[],false,{...check,kind:'garbage'},{...check,checkCount:true},
    {...check,hasDocumentReference:'false'},{...check,checkNumbers:[123]},
    {...check,checkItems:[{...check.checkItems[0],hasDocumentReference:'false'}]},
    {...check,checkItems:[{...check.checkItems[0],amount:true}]},
    {...check,checkItems:[{...check.checkItems[0],imageFrontKey:'javascript:bad'}]}]],
  ['creditSettlementDetails','credit_settlement_details',[[],false,{...settlement,provider:'garbage'},
    {...settlement,detailFetched:'false'},{...settlement,cardLast4s:[1234]},
    {...settlement,cardIdentitySource:'guessed'},{...settlement,bankActivityTypeCode:true}]],
])for(const value of values)test(`${field}: malformed business evidence rejects at every current Bank entrance ${JSON.stringify(value)}`,()=>{
  const bad={...tx,[field]:value};
  assert.throws(()=>readBankBalanceResult({fetchedAt:at,balance:0,transactions:[bad],transactionCoverage:{complete:true}}),{code:'BANK_TRANSACTIONS_INVALID'});
  assert.throws(()=>readBankArchiveRows([{...archive,[sqlField]:value}],'A','business'),{code:'BANK_RESPONSE_EVIDENCE_INVALID'});
  assert.throws(()=>readBankSnapshotRows([{...snapshot,transactions:[bad]}],'A','business'),{code:'BANK_RESPONSE_EVIDENCE_INVALID'});
});
test('decoded evidence preserves explicit false, identities and amounts and cannot change after acceptance',()=>{
  const raw={...tx,checkDetails:structuredClone(check),creditSettlementDetails:structuredClone(settlement)};
  const accepted=readBankBalanceResult({fetchedAt:at,balance:0,transactions:[raw],transactionCoverage:{complete:true}}).business;
  raw.checkDetails.checkItems[0].amount=999;raw.creditSettlementDetails.cardLast4s[0]='9999';
  assert.deepEqual(accepted.transactions[0].checkDetails,check);
  assert.deepEqual(accepted.transactions[0].creditSettlementDetails,settlement);
  assert.throws(()=>{accepted.transactions[0].status='pending'},TypeError);
  assert.throws(()=>accepted.transactions.push(tx),TypeError);
  assert.throws(()=>{accepted.transactionCoverage.complete=false},TypeError);
});
test('the actual Hapoalim producer emits decodable business transactions',()=>{
  const produced=normalizeHapoalimTransaction({eventAmount:20,serialNumber:1,referenceNumber:'T',eventDate:20261016,valueDate:20261016});
  assert.deepEqual(readBankTransaction(produced),produced);
});
test('historical feed normalization never turns the text false into a document reference',()=>{
  for(const normalize of [ordersFeed,kupaFeed]){
    const accepted=normalize({...tx,checkDetails:{...check,hasDocumentReference:'false',
      checkItems:[{...check.checkItems[0],hasDocumentReference:'false'}]}});
    assert.equal(accepted.checkDetails.hasDocumentReference,false);
    assert.equal(accepted.checkDetails.checkItems[0].hasDocumentReference,false);
  }
});
test('SQL aliases for party, activity and reference evidence use the same transaction decoder',()=>{
  for(const patch of [{party_name:false},{party_headline:{}},{message_headline:[]},{message_detail:5},
    {activity_type_code:true},{bank_reference:12},{bank_serial:[]}]){
    assert.throws(()=>readBankArchiveRows([{...archive,...patch}],'A','business'),{code:'BANK_RESPONSE_EVIDENCE_INVALID'});
  }
});
