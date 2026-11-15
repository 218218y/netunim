import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {normalizeCreditSync} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
const record={id:'original',card:'Old card',firstChargeDate:'2024-01-10',totalAmount:100,installments:1,active:false};
function normalizer(){return createStateNormalization({model:{},policies:{normalizeBankFeed:value=>value,
  normalizeCreditSync,inactiveCreditExpired:()=>true}})}
test('old and unversioned backups retain original manual IDs in a visible non-contributing archive',()=>{
  for(const version of [undefined,1,2]){
    const value=normalizer().normalizeState({credits:[record],creditSync:{version}});
    assert.equal(value.credits[0].id,'original');assert.equal(value.credits[0].totalAmount,100);
    assert.equal(value.credits[0].archived,true);
    assert.equal(creditBillingRowsData(value,{asOf:'2026-11-15'}).filter(row=>row.source==='manual').length,0);
    assert.deepEqual(normalizer().normalizeState(JSON.parse(JSON.stringify(value))).credits,value.credits);
  }
});
test('inactive manual records remain in source and backup even when the old age policy says expired',()=>{
  const value=normalizer().normalizeState({credits:[record],creditSync:{version:4}});
  assert.equal(value.credits.length,1);assert.equal(value.credits[0].id,'original');
  assert.notEqual(value.credits[0].archived,true);
});
