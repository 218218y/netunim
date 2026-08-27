import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization as kupaNormalizer} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createStateNormalization as ordersNormalizer} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createSyncMerge as kupaMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createSyncMerge as ordersMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createSyncChecks as orderChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createCloudTransport as orderTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {mergeValue, mergeValuePreferLocal} from '../netunim-kupa/site/assets/js/sync/merge-records.js';

const k=kupaNormalizer({model:{}}),o=ordersNormalizer({});
const km=kupaMerge(k),om=ordersMerge(o);
const check={id:'C',name:'client',amount:100,dueDate:'2026-09-01',status:'בקופה'};
test('optional undefined fields survive merge and rebase without JSON.parse(undefined)',()=>{
 const conflicts=[];
 assert.equal(mergeValue(undefined,undefined,undefined,'optional',conflicts),undefined);
 assert.equal(mergeValuePreferLocal('old',undefined,'old'),undefined);
 assert.equal(mergeValue('old','local',undefined,'optional',conflicts),undefined);
 assert.deepEqual(conflicts,['optional']);
});
for(const [app,api]of [['kupa',kupaChecks({checksSession:{sharedChecksBootstrapActive:false}})],['orders',orderChecks({})]]){
 test(app+' shared checks: independent edits, conflicts, deletion and no input mutation',()=>{
   const base=[check],local=[check,{...check,id:'L'}],remote=[check,{...check,id:'R'}],before=JSON.stringify([base,local,remote]);
   const merged=api.mergeSharedChecks(base,local,remote);
   assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.checks.map(c=>c.id).sort(),['C','L','R']);
   assert.equal(JSON.stringify([base,local,remote]),before);
   assert.ok(api.mergeSharedChecks(base,[{...check,amount:110}],[{...check,amount:120}]).conflicts.length);
   assert.ok(api.mergeSharedChecks(base,[],[{...check,note:'edited'}]).conflicts.length);
   assert.equal(api.mergeSharedChecks(base,[],base).checks.length,0);
 });
}
test('Kupa rebase retains edits made during an in-flight save',()=>{
 const base=k.normalizeState({version:4,checks:[],credits:[],cash:[{id:'A',amount:10}],expenses:[],cards:[]});
 const newer=structuredClone(base);newer.cash[0].amount=15;
 const accepted=structuredClone(base);accepted.expenses.push({id:'E',amount:20});
 const rebased=km.rebaseLocalProgress(base,newer,accepted);
 assert.equal(rebased.cash[0].amount,15);assert.equal(rebased.expenses[0].amount,20);
});
test('Orders rebase and empty fields follow the record conflict contract',()=>{
 const base=o.normalizeState({suppliers:[{id:'S',name:'Supplier'}],notes:[{id:'N',content:'base'}]});
 const local=structuredClone(base),remote=structuredClone(base);
 local.notes[0].content='';remote.suppliers[0].name='remote';
 const merged=om.merge3(base,local,remote);assert.deepEqual(merged.conflicts,[]);
 assert.equal(merged.state.notes[0].content,'');assert.equal(merged.state.suppliers[0].name,'remote');
 remote.notes[0].content='other';
 const rebased=om.merge3(base,local,remote,{preferLocalConflicts:true});
 assert.equal(rebased.state.notes[0].content,'');assert.ok(rebased.conflicts.length);
});
test('shared check transport validates revisions and preserves RPC request contract',async()=>{
 const calls=[];
 const api=orderTransport({supaFetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,text:async()=>JSON.stringify([{revision:8}])}}});
 assert.equal((await api.rpcSaveSharedChecks([check],7)).row.revision,8);
 assert.equal(calls[0][0],'/rest/v1/rpc/save_shared_checks_document');
 assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_document_name','p_expected_revision','p_state']);
 assert.equal(calls[0][1].p_expected_revision,7);assert.equal(calls[0][1].p_state.version,1);
 await assert.rejects(api.rpcSaveSharedChecks([check],-1));
 assert.equal(calls.length,1);
});
