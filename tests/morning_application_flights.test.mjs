import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningLifetime} from '../netunim-orders/site/assets/js/domains/customers/morning-lifetime.js';
import {createMorningDebtApplication} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js';
import {createMorningDebtRecoveryContext,morningFinancialSnapshot,morningFinancialChanges,morningDebtRecoveryMatchesVerified} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t,refresh=async()=>true){
  const debt={id:'same-debt',amount:100,paid:false,invoiceIssued:false},applied=[],decisions=[];
  let stored=null;
  const lifetime=createMorningLifetime({operationScope:{capture:()=>()=>undefined,captureRead:()=>()=>undefined},getPendingOperationId:()=>null,recover(){},onInterrupt(){},events:{}});
  t.after(async()=>{lifetime.dispose();await lifetime.drain()});
  const context=id=>createMorningDebtRecoveryContext({operationId:id,debtId:debt.id,type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:morningFinancialSnapshot(debt)});
  const application=createMorningDebtApplication({lifetime,recovery:{read:()=>stored},debts:{read:()=>debt,refresh,isBlocked:()=>false,apply:command=>{applied.push(command.operationId);return {changed:true,persisted:true}}},policy:{matches:morningDebtRecoveryMatchesVerified,snapshot:morningFinancialSnapshot,changes:morningFinancialChanges},feedback:{toast(){},status(){},decide:context=>decisions.push(context.operationId)}});
  const args=id=>({operationId:id,documentId:'document-'+id,type:320,amount:30,verifiedAt:'2026-10-14T00:00:00Z'});
  return {application,debt,applied,decisions,context,args,store:value=>{stored=value}};
}
test('a new operation cannot join another operation completion in the same account',async t=>{
  const f=fixture(t),a=f.context(A);f.store(a);const first=f.application.apply(a,f.args(A),{immediate:true});
  const unverified=f.application.apply(a,{}, {immediate:true});
  const b=f.context(B);f.store(b);const second=f.application.apply(b,f.args(B),{immediate:true});await Promise.all([first,second]);
  assert.equal((await unverified).reason,'unbound-operation','a local context without provider evidence cannot join a verified completion');
  assert.deepEqual(f.applied,[A,B],'each verified operation requires its own application result');
});
test('coalesced financial work publishes its decision for the current joined display',async t=>{
  const held=gate(),entered=gate();t.after(()=>held.resolve());const f=fixture(t,async()=>{entered.resolve();await held.promise;return true}),context=f.context(A);f.store(context);
  let oldDisplay=true;const first=f.application.apply(context,f.args(A),{isCurrent:()=>oldDisplay});await entered.promise;
  oldDisplay=false;f.debt.amount=90;const second=f.application.apply(context,f.args(A),{isCurrent:()=>true});
  assert.equal(second,first,'same operation and authority still share one accepted application');held.resolve();assert.equal((await second).reason,'decision-required');
  assert.deepEqual(f.decisions,[A],'a current joiner must not inherit the obsolete display fence');assert.deepEqual(f.applied,[]);
});
