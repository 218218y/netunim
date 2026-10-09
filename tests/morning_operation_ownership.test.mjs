import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,morningFinancialSnapshot} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';

const OP='11111111-1111-4111-8111-111111111111',stamp='2026-10-09T00:00:00Z';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
for(const boundary of ['headers','body','refresh','application'])for(const transition of ['account','relogin','leadership'])test(`Morning recovery retains context after ${transition} during ${boundary}`,async()=>{
  const previous=new Map(['localStorage','document','setTimeout','clearTimeout'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const entries=new Map(),storage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  Object.defineProperty(globalThis,'document',{value:{querySelector:()=>null,addEventListener(){}},configurable:true});
  Object.defineProperty(globalThis,'setTimeout',{value:()=>1,configurable:true});Object.defineProperty(globalThis,'clearTimeout',{value:()=>{},configurable:true});
  try{
    const debt={id:'same-debt',amount:100,paid:false,invoiceIssued:false},context=createMorningDebtRecoveryContext({operationId:OP,debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,createdAt:stamp,financialSnapshot:morningFinancialSnapshot(debt)});
    assert.equal(saveMorningDebtRecoveryContext(context),true);
    let account='A',epoch=1,primary=true,applied=0,notifications=0;const entered=deferred(),gate=deferred(),messages=[];
    const change=()=>{if(transition==='account')account='B';else if(transition==='relogin')epoch++;else primary=false};
    const capture=()=>{const observed={account,epoch};if(!primary)throw Object.assign(Error('scope changed'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});return ()=>{if(!primary||account!==observed.account||epoch!==observed.epoch)throw Object.assign(Error('scope changed'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})}};
    const operationScope={capture,captureRead:capture};
    const documents=createDomainsCustomersDocuments({
      operationScope,model:{state:{customerDebts:[debt]}},modal(){},toast:message=>messages.push(message),confirmDialog:async()=>true,markModalDraftSaved(){},dateEditorMarkup:()=>'',
      documentsBrowser:{invalidateCache(){},viewDocument:async()=>false},rejectSecondaryIssuance:()=>false,rejectSecondaryMutation:()=>false,
      refreshForMorningRecovery:async()=>{if(boundary==='refresh'){entered.resolve();await gate.promise}return true},
      applyVerifiedDebtDocument:()=>{applied++;if(boundary==='application'){entered.resolve();queueMicrotask(change)}return {changed:true,persisted:true}},
      onBankDocumentVerified:()=>{notifications++},
      supaFetch:async()=>{
        if(boundary==='headers'){entered.resolve();await gate.promise}
        return {ok:true,json:async()=>{if(boundary==='body'){entered.resolve();await gate.promise}return {ok:true,operation:{operation_id:OP,state:'created',document_type:320,amount:30,document_id:'document-A',verified_at:stamp}}}};
      },
    });
    const work=documents.recoverPendingMorningOperation();await entered.promise;
    if(boundary!=='application')change();gate.resolve();const result=await work;
    assert.equal(applied,boundary==='application'?1:0,'a verified result cannot allocate debt under changed authority');
    assert.deepEqual(loadMorningDebtRecoveryContext(),context,'old completion cannot clear durable recovery');
    assert.equal(result.ok,false,'stale completion cannot report success');assert.equal(notifications,0);
    assert.equal(messages.some(message=>message.includes('????? ??? ???????')),false);
  }finally{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
});
