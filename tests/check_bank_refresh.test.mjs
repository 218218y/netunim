import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckBankRefresh} from '../shared/check-bank-refresh.js';
import {normalizeSharedChecks,normalizeSharedBankEvents} from '../shared/shared-checks-contract.js';
import {createDomainsChecksEditor as ordersEditor} from '../netunim-orders/site/assets/js/domains/checks/editor.js';
import {createDomainsChecksEditor as kupaEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createRestoreGroup,restoreGroupRpcPayload} from '../shared/restore-groups.js';
import {createDeferredCheckBankRefresh} from '../shared/shared-checks-flight.js';

function fixture(create=createCheckBankRefresh,onSync=()=>{}){
  let owner='one',ready=true,rows=[{id:'a',amount:123.45}],calls=0,syncs=0,renders=0;
  const pending=new Map(),messages=[];let sequence=0,result={status:'checked',changed:1,snapshotAt:'2026-08-10T12:00:00Z'};
  const api=create({owner:()=>owner,ready:()=>ready,checks:()=>rows,
    refresh:async()=>{calls++;return typeof result==='function'?result():result},
    sync:async()=>{syncs++;onSync();return true},render:()=>renders++,toast:message=>messages.push(message),
    timers:{setTimeout:(run,delay)=>{pending.set(++sequence,{run,delay});return sequence},clearTimeout:id=>pending.delete(id)}});
  return {api,pending,messages,rows,setOwner:value=>owner=value,setReady:value=>ready=value,setResult:value=>result=value,
    stats:()=>({calls,syncs,renders}),async fire(){const work=[...pending.values()];pending.clear();for(const {run} of work)run();await api.drain()}};
}
test('startup waits, matching edits debounce after ACK, display/history changes do not schedule',async()=>{
  const f=fixture();f.setReady(false);f.api.observe();assert.equal(f.pending.size,0);
  f.setReady(true);f.api.observe();assert.equal([...f.pending.values()][0].delay,4000);await f.fire();
  f.rows[0].note='memo';f.rows[0].bankHistory=[{eventId:'x'}];f.api.observe();assert.equal(f.pending.size,0);
  f.rows[0].amount=124.45;f.api.observe();f.rows[0].amount=125.45;f.api.observe();
  assert.equal(f.pending.size,1);assert.equal([...f.pending.values()][0].delay,1500);await f.fire();
  assert.deepEqual(f.stats(),{calls:2,syncs:2,renders:2});
});

test('an empty list does not schedule bank work; the first cheque schedules after ACK',async()=>{
  const f=fixture();f.rows.length=0;f.api.observe();assert.equal(f.pending.size,0);
  f.rows.push({id:'first',amount:10.25});f.api.observe();assert.equal(f.pending.size,1);
  f.rows.length=0;f.api.observe();assert.equal(f.pending.size,0);
  f.rows.push({id:'next',amount:10.25});f.api.observe();await f.fire();assert.equal(f.stats().calls,1);
});
test('single flight and ownership loss fence publication; disposal cancels deferred work',async()=>{
  const f=fixture();let finish;f.setResult(()=>new Promise(resolve=>finish=resolve));
  const a=f.api.run(),b=f.api.run();assert.equal(a,b);f.setOwner('two');finish({status:'checked'});
  await a;assert.deepEqual(f.stats(),{calls:1,syncs:0,renders:0});
  f.api.observe();assert.equal(f.pending.size,1);f.api.dispose();assert.equal(f.pending.size,0);
});

test('adopting a matching result during sync does not schedule a redundant replay',async()=>{
  const f=fixture(createCheckBankRefresh,()=>{f.rows[0].status='הופקד - במעקב';f.api.observe()});
  f.api.observe();await f.fire();
  assert.equal(f.pending.size,0);assert.equal(f.stats().calls,1);
});
test('manual refresh refuses unsynced work and communicates the actual stored observation time',async()=>{
  const f=fixture(),button={disabled:false,textContent:'רענן התאמות'};
  f.setResult({status:'pending'});await f.api.manual(button);assert.match(f.messages[0],/ממתינים לסנכרון/);
  assert.equal(button.disabled,false);assert.equal(f.stats().syncs,0);
  f.setResult({status:'checked',changed:2,snapshotAt:'2026-08-10T12:00:00Z'});await f.api.manual(button);
  assert.match(f.messages[1],/2/);assert.match(f.messages[1],/2026/);assert.match(f.messages[1],/השמורים/);
  f.setResult({status:'checked',snapshotFromAt:'2026-08-01T12:00:00Z',snapshotAt:'2026-08-10T12:00:00Z'});await f.api.manual(button);
  assert.match(f.messages[2],/צילומי הבנק/);assert.match(f.messages[2],/1\.8\.2026/);assert.match(f.messages[2],/10\.8\.2026/);
  f.setResult({status:'busy'});const before=f.stats().syncs;await f.api.manual(button);
  assert.match(f.messages[3],/אוטומטית/);assert.equal(f.stats().syncs,before);
});
test('shared checks and server balance deltas retain cents through normalization and reload',()=>{
  const source={id:'a',name:'Client',amount:100.25,morningSource:{documentId:'doc',paymentIndex:2},accountNumber:'000456'};
  const rows=normalizeSharedChecks([source]);assert.equal(rows[0].amount,100.25);assert.deepEqual(rows[0].morningSource,source.morningSource);
  assert.deepEqual(normalizeSharedChecks(JSON.parse(JSON.stringify(rows))),rows);
  assert.equal(normalizeSharedBankEvents([{seq:1,delta:-100.25,checkId:'a'}])[0].delta,-100.25);
});
for(const [site,create] of [['orders',ordersEditor],['kupa',kupaEditor]])test(`${site}: only an explicit amount edit changes its durable amount marker`,()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),noop=()=>{};
  const fields={fName:{value:'Client'},fAmount:{value:'100.25'},fDue:{value:'2026-11-01'},fStatus:{value:'בקופה'},
    fNum:{value:'111'},fNote:{value:'note'},fCheckHome:{checked:false},fCheckAuto:{checked:true}};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>fields[id],querySelector:selector=>fields[selector.slice(1)]}});
  try{
    const model={state:{checks:[{id:'a',amount:100.25,status:'בקופה',morningSource:{documentId:'doc'}}]}};
    const editor=create({model,ui:{},toast:noop,normalizeCheckModalDates:()=>true,scheduleCheckSave:noop,saveChecksState:noop,closeModal:noop});
    editor.saveCheck('a');assert.equal(model.state.checks[0].amountEditId,undefined);
    fields.fAmount.value='100.50';editor.saveCheck('a');const marker=model.state.checks[0].amountEditId;
    assert.ok(marker);assert.equal(model.state.checks[0].amount,100.5);
    fields.fNote.value='another note';editor.saveCheck('a');assert.equal(model.state.checks[0].amountEditId,marker);
    assert.equal(model.state.checks[0].morningSource.documentId,'doc');
  }finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document}
});
test('restore precision is captured with the durable group and never added to a legacy retry',async()=>{
  const group=await createRestoreGroup({appSite:'orders',owner:'A',main:{state:{notes:[]},baseRevision:1}});
  assert.equal(restoreGroupRpcPayload(group).p_audit.checkAmountPrecision,2);
  const legacy=structuredClone(group);delete legacy.checkAmountPrecision;
  assert.equal(Object.hasOwn(restoreGroupRpcPayload(legacy).p_audit,'checkAmountPrecision'),false);
});
test('deferred controller cancellation and disposal fence a late module load',async()=>{
  const f=fixture(createDeferredCheckBankRefresh);f.api.observe();f.api.cancel();await f.api.drain();
  assert.equal(f.pending.size,0);f.api.observe();assert.equal(f.pending.size,1);
  f.api.dispose();assert.equal(f.pending.size,0);
});
test('deferred manual clicks join one request and cannot migrate to a replacement owner',async()=>{
  const f=fixture(createDeferredCheckBankRefresh),button={textContent:'רענן התאמות',disabled:false};
  const first=f.api.manual(button);assert.equal(f.api.manual(button),first);f.setOwner('two');await first;
  assert.equal(f.stats().calls,0);assert.equal(button.disabled,false);assert.equal(f.messages.length,0);f.api.dispose();
});
