import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningIssuance} from '../netunim-orders/site/assets/js/domains/customers/morning-issuance.js';
import {createMorningRequest} from '../netunim-orders/site/assets/js/integrations/morning.js';
import {createMorningOperationCommands} from '../netunim-orders/site/assets/js/domains/customers/morning-operation-commands.js';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,loadMorningDebtRecoveryContext} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';

const OP='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const operationScope={capture:()=>()=>undefined,captureRead:()=>()=>undefined};
const requestFor=read=>createMorningRequest({operationScope,supaFetch:async(_path,options)=>new Response(JSON.stringify(read(JSON.parse(options.body))))});

for(const operationId of [OTHER,undefined])test(`reservation ${operationId?'for another operation':'without identity'} cannot persist recovery or enter create`,async()=>{
  const calls=[];let persisted=0;
  const request=requestFor(input=>{calls.push(input.action);return input.action==='reserve'?{ok:true,reserved:true,operation:{operation_id:operationId,state:'reserved'}}:{ok:true,verified:true,document:{id:'official',type:305,amount:42}}});
  const issuer=createMorningIssuance({commands:createMorningOperationCommands({request}),recovery:{persist(){persisted++},reset(){},block(){}}});
  await assert.rejects(issuer.issue({operation_id:OP,document:{type:305,amount:42}},{operationId:OP},operationScope.capture()),{code:'morning_operation_response_invalid'});
  assert.equal(persisted,0);assert.deepEqual(calls,['reserve']);
});

for(const [label,operation,amount] of [
  ['foreign failed operation',{operation_id:OTHER,state:'failed'},42],
  ['foreign reserved operation',{operation_id:OTHER,state:'reserved'},42],
  ['invalid verification date',{operation_id:OP,state:'created',document_id:'official',document_type:305,amount:42,verified_at:'not-a-date'},42],
  ['boolean financial evidence',{operation_id:OP,state:'created',document_id:'official',document_type:305,amount:true,verified_at:'2026-10-14T00:00:00Z'},1],
])test(`recovery retains exact context and performs no mutation for ${label}`,async t=>{
  const previous=new Map(['localStorage','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),entries=new Map(),calls=[];
  Object.defineProperty(globalThis,'document',{value:{querySelector:()=>null},configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)},configurable:true});
  let documents;
  t.after(async()=>{documents?.dispose();await documents?.runtime.drain();for(const [key,value] of previous)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]});
  const context=createMorningDebtRecoveryContext({operationId:OP,type:305,amount,sourceKind:'standalone'});saveMorningDebtRecoveryContext(context);
  const request=requestFor(input=>{calls.push(input.action);return {ok:true,operation:input.action==='abandon_reservation'?{operation_id:OTHER,state:'failed'}:operation,abandoned:input.action==='abandon_reservation'}});
  documents=createDomainsCustomersDocuments({operationScope,request,model:{state:{customerDebts:[]}},modal(){},toast(){},documentsBrowser:{},dateEditorMarkup:()=>''});
  assert.equal((await documents.recoverPendingMorningOperation()).ok,false);
  assert.deepEqual(loadMorningDebtRecoveryContext(),context);assert.deepEqual(calls,['status']);
});
