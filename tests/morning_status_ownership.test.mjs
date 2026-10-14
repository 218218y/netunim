import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningRequest} from '../netunim-orders/site/assets/js/integrations/morning.js';
import {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';
const OP='11111111-1111-4111-8111-111111111111',gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t){
  const prior=new Map(['localStorage','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),entries=new Map(),writes=[],drafts=[];
  let surface='original',present=true,root=null;
  const modalRoot={querySelector:selector=>selector==='#morningConnectionStatus'?header:selector==='[data-action="morning-create"]'?button:null,querySelectorAll:()=>[]};
  const header={matches:()=>false,_html:'',set innerHTML(value){this._html=value;writes.push({surface,value})},get innerHTML(){return this._html}},button={dataset:{},disabled:false};
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)},configurable:true});
  Object.defineProperty(globalThis,'document',{value:{querySelector:selector=>selector.startsWith('#modal [data-morning-generation=')?(present?root:null):selector==='#modalBackdrop'?{classList:{contains:()=>present}}:selector==='#morningConnectionStatus'?header:selector==='[data-action="morning-create"]'?button:null,querySelectorAll:()=>[]},configurable:true});
  const operationScope={capture:()=>()=>undefined,captureRead:()=>()=>undefined},debt={id:'exact-debt',amount:100,paid:false,invoiceIssued:false};
  let documents;
  const build=ports=>documents=createDomainsCustomersDocuments({operationScope,model:{state:{customerDebts:[debt]}},modal(){root={isConnected:true,closest:()=>modalRoot,querySelector:()=>null,querySelectorAll:()=>[]}},toast(){},documentsBrowser:{},dateEditorMarkup:()=>'',markModalDraftSaved:()=>drafts.push(surface),...ports,request:createMorningRequest({operationScope,supaFetch:ports.supaFetch})});
  t.after(async()=>{documents?.dispose();await documents?.runtime.drain();for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]});
  return {build,debt,header,button,writes,drafts,replace:()=>{surface='replacement';present=false}};
}

test('accepted status allocation finishes but cannot publish or mark a replacement modal saved',async t=>{
  const f=fixture(t),held=gate(),entered=gate();t.after(()=>held.resolve());let applied=0;
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:f.debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:morningFinancialSnapshot(f.debt)});saveMorningDebtRecoveryContext(context);
  const documents=f.build({refreshForMorningRecovery:async()=>{entered.resolve();await held.promise;return true},applyVerifiedDebtDocument:()=>{applied++;return {changed:true,persisted:true}},
    supaFetch:async()=>new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'production',operation:{operation_id:OP,state:'created',document_id:'official',document_type:320,amount:30,verified_at:'2026-10-14T00:00:00Z'}}))});
  const work=documents.openMorningDocumentModal({debtId:f.debt.id,source:{kind:'debt'}});await entered.promise;f.replace();held.resolve();await work;
  assert.equal(applied,1,'accepted allocation is not abandoned when its display is replaced');assert.equal(loadMorningDebtRecoveryContext(),null,'original durable settlement can finish');
  assert.deepEqual(f.drafts,[],'an old status completion cannot certify another modal draft');
  assert.equal(f.writes.filter(row=>row.surface==='replacement').length,0,'the former form cannot publish status into a replacement surface');
});

test('an older status response cannot overwrite the later read in the same form',async t=>{
  const f=fixture(t),held=gate(),entered=gate();t.after(()=>held.resolve());let calls=0;
  const documents=f.build({supaFetch:async()=>{if(++calls===1){entered.resolve();await held.promise;return new Response(JSON.stringify({ok:true,configured:false,available:false,environment:'production',operation:null}))}return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'production',operation:null}))}});
  const first=documents.openMorningDocumentModal();await entered.promise;await documents.refreshStatus();const latest=f.header.innerHTML;
  assert.equal(f.button.disabled,false);held.resolve();await first;
  assert.equal(f.header.innerHTML,latest,'a delayed former read must not replace newer connection evidence');assert.equal(f.button.disabled,false);
});
