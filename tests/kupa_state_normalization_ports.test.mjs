import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

test('Kupa state normalization requires its domain policy ports before recovery',()=>{
  assert.throws(()=>createStateNormalization({model:{}}),/kupa_state_normalization_policies_required/);
  assert.throws(()=>createStateNormalization({model:{},policies:{normalizeBankFeed:()=>null}}),/kupa_state_normalization_policies_required/);
});

test('Kupa normalization delegates bank, credit sync and credit expiry to bound policies',()=>{
  const calls=[],bankFeed={source:'bank'},homeFeed={source:'home'},creditSync={version:3,source:'issuer'};
  const policies={
    normalizeBankFeed(value){calls.push(['bank',value]);return value?{syncedAt:'2026-10-01T00:00:00.000Z'}:null},
    normalizeCreditSync(value){calls.push(['sync',value]);return {version:4,profiles:[]}},
    inactiveCreditExpired(value){calls.push(['expiry',value.id]);return value.id==='expired'},
  };
  const model={},normalization=createStateNormalization({model,policies});
  const state=normalization.normalizeState({bank:{feed:bankFeed,homeFeed},creditSync,credits:[{id:'kept'},{id:'expired'}]});
  assert.deepEqual(state.credits.map(credit=>credit.id),['kept']);
  assert.deepEqual(model.lastNormalizeRemovedCreditIds,['expired']);
  assert.deepEqual(calls,[['bank',bankFeed],['bank',homeFeed],['sync',creditSync],['expiry','kept'],['expiry','expired']]);
});
