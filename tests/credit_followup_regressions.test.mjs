import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {normalizeCreditSync} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
const tx={id:'reused',date:'2026-11-01',processedDate:null,status:'completed',originalAmount:-100,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS'};
const payload=rows=>({profiles:[{profileId:'P',provider:'max',coreComplete:true,accounts:[{accountNumber:'C',unassignedTransactions:rows}]}]});
for(const [name,merge] of [['kupa',kupa],['orders',orders]])test(name+' identical repeated IDs preserve the financial multiset without a false regression',()=>{
  for(const rows of [[{...tx,description:'A'},{...tx,description:'B'}],[{...tx,chargedAmount:null},{...tx,description:'converted'}]]){
    const old=merge({cardMappings:{'P:C':{included:true}}},payload(rows)),next=merge(old,payload([...rows].reverse()));
    assert.equal(next.errors.length,0);assert.equal(next.profiles[0].coreComplete,true);
    assert.equal(next.profiles[0].accounts[0].unassignedTransactions.length,2);
    assert.equal(merge(old,payload([rows[1]])).errors[0].code,'CREDIT_UNASSIGNED_REGRESSION');
  }
});
test('a legacy manual-only backup keeps its active financial contribution',()=>{
  const normalize=createStateNormalization({model:{},policies:{normalizeBankFeed:x=>x,normalizeCreditSync,inactiveCreditExpired:()=>true}}).normalizeState;
  const state=normalize({credits:[{id:'manual',card:'Card',firstChargeDate:'2026-11-20',totalAmount:100,installments:1,active:true}]});
  assert.notEqual(state.credits[0].archived,true);
  assert.equal(creditBillingRowsData(state,{asOf:'2026-11-15'}).filter(row=>row.source==='manual').reduce((n,row)=>n+row.amount,0),100);
});

