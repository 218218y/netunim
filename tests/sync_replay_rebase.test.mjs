import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncMerge as ordersMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {createSyncMerge as kupaMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createStateNormalization as ordersNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createStateNormalization as kupaNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
const clone=structuredClone, noop=()=>{};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.localStorage={setItem:noop,getItem:()=>null};
const o=ordersNormalization({}),k=kupaNormalization({model:{}});

for(const field of ['businessName','inventoryCategoryOrder','importAudit','stage2Audit'])test(`orders strict scalar ${field}`,()=>{const values=field==='businessName'?['A','B','C']:field==='inventoryCategoryOrder'?[['A'],['B'],['C']]:[{value:'A'},{value:'B'},{value:'C'}];const result=ordersMerge({normalizeState:clone}).merge3({[field]:values[0]},{[field]:values[1]},{[field]:values[2]});assert.ok(result.conflicts.includes(field))});
for(const app of ['orders','kupa'])test(`${app} strict post-ACK merge retains delete protections`,()=>{
 const api=app==='orders'?ordersMerge(o).merge3:kupaMerge(k).rebaseKupaCloudProgress,norm=app==='orders'?o.normalizeState:k.normalizeState,base=norm({notes:[{id:'X',content:'base'},{id:'Y',content:'other'}]}),missing=clone(base),remote=clone(base);missing.notes=[];remote.notes[0].content='remote';
 assert.equal(api(base,missing,remote).conflicts.length,0);assert.equal(api(base,missing,remote).state.notes.length,2);
 assert.ok(api(base,missing,remote,{deleteIntents:{notes:['X']}}).conflicts.length);
 const deletion=clone(base);deletion.notes=deletion.notes.filter(x=>x.id!=='X');remote.notes[0].content='base';remote.notes[1].content='other-edit';const merged=api(base,deletion,remote,{deleteIntents:{notes:['X']}});assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.state.notes.map(x=>x.id),['Y']);
});
for(const app of ['orders','kupa'])test(`${app} JSONB key order is not a remote business change`,()=>{
 const base={notes:[{id:'X',content:'base',extra:{x:1,y:2}}]},local={notes:[{id:'X',content:'local',extra:{x:1,y:2}}]},remote={notes:[{extra:{y:2,x:1},content:'base',id:'X'}]};
 const api=app==='orders'?ordersMerge({normalizeState:clone}).merge3:kupaMerge({normalizeState:clone,prepareKupaCloudState:clone}).mergeKupaCloudState3Way;
 const result=api(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.state.notes[0].content,'local');
 const checks=(app==='orders'?ordersChecks:kupaChecks)({checksSession:{}});const cb=[{id:'X',amount:10,name:'base'}],cl=[{id:'X',amount:11,name:'base'}],cr=[{name:'base',amount:10,id:'X'}];assert.deepEqual(checks.mergeSharedChecks(cb,cl,cr).conflicts,[]);
});
