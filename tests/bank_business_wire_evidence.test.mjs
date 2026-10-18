import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readBankTransaction} from '../shared/bank-transaction-evidence.js';
import {readBankBalanceResult} from '../shared/bank-balance-result.js';
import {readBankArchiveRows,readBankSnapshotRows} from '../shared/bank-response-records.js';
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/bank-business-wire-evidence.json',import.meta.url),'utf8'));
const at='2026-10-16T10:00:00Z';
const tx={id:'T',mergeKey:'T',date:at,amount:20,currency:'ILS',status:'completed'};
const archive={id:1,account_key:'A',account_role:'business',merge_key:'T',amount:20,currency:'ILS',status:'completed',
  first_seen_at:at,transaction_date:at,processed_date:null,last_seen_at:null,missing_since:null,missing_acknowledged_at:null,
  presence_state:'present',alert_acknowledgements:{},cheque:true,balance_after:null};
const snapshot={account_key:'A',account_role:'business',snapshot_at:at,coverage_from:'2026-10-01',coverage_to:'2026-10-16',transaction_count:1};
test('the PostgreSQL/JavaScript wire corpus retains distinct named positive and negative cases',()=>{
  assert.equal(cases.length,112);
  assert.equal(new Set(cases.map(row=>row.name)).size,cases.length);
  assert.ok(cases.some(row=>row.valid)&&cases.some(row=>!row.valid));
});
for(const row of cases)test('Bank business wire parity: '+row.name,()=>{
  const value={...tx,...row.patch},sql={...archive};
  for(const [field,alias] of [['checkDetails','check_details'],['creditSettlementDetails','credit_settlement_details']]){
    if(Object.hasOwn(row.patch,field))sql[alias]=row.patch[field];
  }
  const entrances=[
    [()=>readBankTransaction(value),'BANK_TRANSACTIONS_INVALID'],
    [()=>readBankBalanceResult({fetchedAt:at,balance:0,transactionCoverage:{complete:true},transactions:[value]}),'BANK_TRANSACTIONS_INVALID'],
    [()=>readBankArchiveRows([sql],'A','business'),'BANK_RESPONSE_EVIDENCE_INVALID'],
    [()=>readBankSnapshotRows([{...snapshot,transactions:[value]}],'A','business'),'BANK_RESPONSE_EVIDENCE_INVALID'],
  ];
  for(const [read,code] of entrances){
    if(row.valid)assert.doesNotThrow(read);
    else assert.throws(read,{code});
  }
});
