import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';

const OP='11111111-1111-4111-8111-111111111111';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t,{refresh=async()=>true,apply=()=>assert.fail('financial changes require a decision')}={}){
  const prior=new Map(['document','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),entries=new Map(),listeners=new Set();
  let opened=false,root=null,documents,marked=0;
  const panel={hidden:true,innerHTML:'',replaceChildren(){this.innerHTML=''}},status={matches:()=>false},payment={checked:true},invoice={checked:true};
  const fields=new Map([['#morningRecoveryDecision',panel],['#morningConnectionStatus',status],['#morningRecoveryPayment',payment],['#morningRecoveryInvoice',invoice]]);
  const modalRoot={querySelector:selector=>fields.get(selector)||null,querySelectorAll:()=>[]};
  const modal=(title,body)=>{if(root)root.isConnected=false;opened=true;root={isConnected:true,closest:()=>modalRoot};if(!body.includes('morningRecoveryDecision'))fields.clear();};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:selector=>selector==='#modalBackdrop'?{classList:{contains:()=>opened}}:selector.startsWith('#modal [data-morning-generation=')?root:fields.get(selector)||null}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)}});
  const debt={id:'decision-debt',amount:100,paid:false,invoiceIssued:false},before=morningFinancialSnapshot(debt);
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:before});
  saveMorningDebtRecoveryContext(context);debt.amount=80;
  documents=createDomainsCustomersDocuments({operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},subscribeAccountScope:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},model:{state:{customerDebts:[debt]}},modal,toast(){},dateEditorMarkup:()=>'',markModalDraftSaved:()=>{marked++},documentsBrowser:{},refreshForMorningRecovery:refresh,applyVerifiedDebtDocument:apply,request:{json:async()=>({ok:true,operation:{operation_id:OP,state:'created',document_id:'exact-document',document_type:320,amount:30,verified_at:'2026-10-14T00:00:00Z'}})}});
  t.after(async()=>{documents.dispose();await documents.runtime.drain();for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]});
  return {documents,panel,context,listeners,replace:()=>modal('Other feature','<div id="other">dirty draft</div>'),closed:()=>{opened=false},root:()=>root,marked:()=>marked};
}

for(const boundary of ['account','dispose'])test(`a recovery-only decision surface is owned and cleared on ${boundary}`,async t=>{
  const f=fixture(t);const result=await f.documents.recoverPendingMorningOperation();assert.equal(result.result.reason,'decision-required');
  const displayed=f.root();assert.equal(displayed.isConnected,true);assert.equal(f.panel.hidden,false);
  if(boundary==='account')for(const listener of f.listeners)listener();else f.documents.dispose();
  assert.equal(displayed.isConnected,false,'the decision surface must be cleared even when no issuance form was opened');
  assert.deepEqual(loadMorningDebtRecoveryContext(),f.context,'visual cleanup preserves exact pending recovery');
});

test('a detached recovery decision cannot save choices into durable recovery or certify another draft',async t=>{
  const f=fixture(t);await f.documents.recoverPendingMorningOperation();const marked=f.marked();f.replace();
  assert.equal(f.documents.saveRecoveryChoice(),false,'choice commands require their mounted decision surface');
  assert.deepEqual(loadMorningDebtRecoveryContext(),f.context,'detached controls cannot save false allocation choices');assert.equal(f.marked(),marked);
});

test('a closed recovery decision cannot authorize a new choice write',async t=>{
  const f=fixture(t);await f.documents.recoverPendingMorningOperation();f.closed();
  assert.equal(f.documents.saveRecoveryChoice(),false);assert.deepEqual(loadMorningDebtRecoveryContext(),f.context);
});

test('an accepted recovery confirmation can finish without certifying a replacement draft',async t=>{
  const held=gate(),entered=gate();t.after(()=>held.resolve());let calls=0,applied=0;
  const f=fixture(t,{refresh:async()=>{if(++calls===2){entered.resolve();await held.promise}return true},apply:()=>{applied++;return {changed:true,persisted:true}}});
  await f.documents.recoverPendingMorningOperation();const confirming=f.documents.confirmRecoveryChoice();await entered.promise;
  const marked=f.marked();f.replace();held.resolve();await confirming;
  assert.equal(applied,1,'accepted approved allocation still completes for its original operation');assert.equal(loadMorningDebtRecoveryContext(),null);
  assert.equal(f.marked(),marked,'confirmation completion cannot mark an unrelated draft saved');
});
