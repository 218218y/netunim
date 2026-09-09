import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORNING_DEBT_RECOVERY_STORAGE_KEY,
  createMorningDebtRecoveryContext,
  normalizeMorningDebtRecoveryContext,
  loadMorningDebtRecoveryContext,
  saveMorningDebtRecoveryContext,
  clearMorningDebtRecoveryContext,
  morningDebtRecoveryMatchesVerified,
  morningVerifiedApplicationDurable,
} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';
import {applyVerifiedMorningDocumentToDebt} from '../netunim-orders/site/assets/js/domains/customers/morning-debt.js';
import {customerDebtProgressData} from '../netunim-orders/site/assets/js/shared/customer-debt-progress.js';

class MemoryStorage {
  constructor(){this.map=new Map();this.failSet=false;this.failRemove=false}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){if(this.failSet)throw new Error('quota');this.map.set(key,String(value))}
  removeItem(key){if(this.failRemove)throw new Error('locked');this.map.delete(key)}
}

const OP='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const CREATED='2026-09-09T10:15:00.000Z';

test('recovery context persists only the minimal debt binding and independent allocation policy',()=>{
  const storage=new MemoryStorage();
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt-7',type:320,amount:1250.75,applyPayment:false,applyInvoice:true,createdAt:CREATED});
  assert.deepEqual(context,{version:1,operationId:OP,debtId:'debt-7',type:320,amount:1250.75,applyPayment:false,applyInvoice:true,createdAt:CREATED});
  assert.equal(saveMorningDebtRecoveryContext(context,storage),true);
  assert.deepEqual(loadMorningDebtRecoveryContext(storage),context);
  const raw=JSON.parse(storage.getItem(MORNING_DEBT_RECOVERY_STORAGE_KEY));
  assert.deepEqual(Object.keys(raw).sort(),['amount','applyInvoice','applyPayment','createdAt','debtId','operationId','type','version'].sort());
  assert.ok(!('documentId' in raw)&&!('pdf' in raw)&&!('url' in raw)&&!('client' in raw));
});

test('verified Morning data must match operation, document type and exact cent amount before a recovered debt can change',()=>{
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt-1',type:400,amount:100.25,applyPayment:true,applyInvoice:false,createdAt:CREATED});
  assert.equal(morningDebtRecoveryMatchesVerified(context,{operationId:OP,type:400,amount:100.25}),true);
  assert.equal(morningDebtRecoveryMatchesVerified(context,{operationId:OTHER,type:400,amount:100.25}),false);
  assert.equal(morningDebtRecoveryMatchesVerified(context,{operationId:OP,type:320,amount:100.25}),false);
  assert.equal(morningDebtRecoveryMatchesVerified(context,{operationId:OP,type:400,amount:100.24}),false);
});

test('clear is operation-scoped so an obsolete callback cannot remove a newer recovery context',()=>{
  const storage=new MemoryStorage();
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt-1',type:305,amount:50,applyInvoice:true,createdAt:CREATED});
  assert.equal(saveMorningDebtRecoveryContext(context,storage),true);
  assert.equal(clearMorningDebtRecoveryContext(OTHER,storage),false);
  assert.deepEqual(loadMorningDebtRecoveryContext(storage),context);
  assert.equal(clearMorningDebtRecoveryContext(OP,storage),true);
  assert.equal(loadMorningDebtRecoveryContext(storage),null);
});

test('corrupt or stale-shaped storage is rejected and cleaned instead of being trusted',()=>{
  const storage=new MemoryStorage();
  storage.setItem(MORNING_DEBT_RECOVERY_STORAGE_KEY,JSON.stringify({version:1,operationId:'not-a-uuid',debtId:'x',type:320,amount:100,applyPayment:true,applyInvoice:true,createdAt:CREATED}));
  assert.equal(loadMorningDebtRecoveryContext(storage),null);
  assert.equal(storage.getItem(MORNING_DEBT_RECOVERY_STORAGE_KEY),null);
  assert.equal(normalizeMorningDebtRecoveryContext({version:1,operationId:OP,debtId:'x',type:999,amount:100,createdAt:CREATED}),null);
});

test('failure to durably write or remove local recovery fails closed',()=>{
  const storage=new MemoryStorage();
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt-1',type:320,amount:100,applyPayment:true,applyInvoice:true,createdAt:CREATED});
  storage.failSet=true;
  assert.equal(saveMorningDebtRecoveryContext(context,storage),false);
  storage.failSet=false;
  assert.equal(saveMorningDebtRecoveryContext(context,storage),true);
  storage.failRemove=true;
  assert.equal(clearMorningDebtRecoveryContext(OP,storage),false);
  assert.deepEqual(loadMorningDebtRecoveryContext(storage),context);
});


test('saved allocation policy survives reload and prevents a manual payment from being deducted again',()=>{
  const storage=new MemoryStorage();
  const context=createMorningDebtRecoveryContext({operationId:OP,debtId:'debt-1',type:320,amount:30,applyPayment:false,applyInvoice:true,createdAt:CREATED});
  assert.equal(saveMorningDebtRecoveryContext(context,storage),true);
  const recovered=loadMorningDebtRecoveryContext(storage),debt={id:'debt-1',amount:100,paid:false,invoiceIssued:false,debtProgress:[{id:'MANUAL-30',kind:'payment',action:'add',amount:30,source:'manual',createdAt:'2026-09-09T09:00:00.000Z'}]};
  const result=applyVerifiedMorningDocumentToDebt(debt,{operationId:recovered.operationId,type:recovered.type,amount:recovered.amount,applyPayment:recovered.applyPayment,applyInvoice:recovered.applyInvoice,verifiedAt:'2026-09-09T11:00:00.000Z'});
  assert.equal(result.changed,true);
  const progress=customerDebtProgressData(debt);assert.equal(progress.paymentApplied,30);assert.equal(progress.invoiceApplied,30);
  assert.equal(debt.debtProgress.filter(row=>row.kind==='payment').length,1);assert.equal(debt.debtProgress.filter(row=>row.kind==='invoice'&&row.source==='morning').length,1);
});


test('verified recovery durability uses an explicit safe allowlist and unknown outcomes fail closed',()=>{
  for(const reason of ['standalone','skipped-by-policy','no-balance','ineligible-debt'])assert.equal(morningVerifiedApplicationDurable({changed:false,reason}),true,reason);
  assert.equal(morningVerifiedApplicationDurable({changed:true,persisted:true}),true);
  assert.equal(morningVerifiedApplicationDurable({changed:false,reason:'already-applied',persisted:true}),true);
  for(const result of [
    null,
    {changed:true},
    {changed:true,persisted:false},
    {changed:false,reason:'already-applied'},
    {changed:false,reason:'missing-debt'},
    {changed:false,reason:'write-blocked'},
    {changed:false,reason:'verification-mismatch'},
    {changed:false,reason:'no-handler'},
    {changed:false,reason:'editor-unavailable'},
    {changed:false,reason:'unbound-operation'},
    {changed:false,reason:'future-unknown-result'},
  ])assert.equal(morningVerifiedApplicationDurable(result),false,JSON.stringify(result));
});
