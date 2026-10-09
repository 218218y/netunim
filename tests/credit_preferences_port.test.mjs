import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditPreferences} from '../netunim-kupa/site/assets/js/platform/credit-preferences.js';

const keys={enabled:'netunim_kupa_credit_auto_daily_v1',mode:'netunim_kupa_credit_auto_mode_v1',attempt:'netunim_kupa_credit_auto_attempt_v1'};
function memory(values=new Map()){
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};
}
test('construction is lazy, preserving historical defaults, keys and attempt time',()=>{
  const storage=memory(),api=createCreditPreferences({storage,now:()=>12345});
  assert.deepEqual(api.read(),{ok:true,value:{enabled:true,mode:null,attemptAt:0}});
  api.setEnabled(false);api.setMode('forecast');api.markAttempt();
  assert.deepEqual([...storage.values],[[keys.enabled,'0'],[keys.mode,'forecast'],[keys.attempt,'12345']]);
  assert.deepEqual(api.read(),{ok:true,value:{enabled:false,mode:'forecast',attemptAt:12345}});
  api.reset();assert.deepEqual([...storage.values],[[keys.enabled,'0'],[keys.mode,'smart']]);
});
test('raw historical mode is passed to the existing domain compatibility policy',()=>{
  const api=createCreditPreferences({storage:memory(new Map([[keys.mode,'full']]))});
  assert.equal(api.read().value.mode,'full');
});
test('browser property access itself is inside the failure boundary',t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let reads=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){reads++;throw new DOMException('secret diagnostic','SecurityError')}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage});
  const api=createCreditPreferences();assert.equal(reads,0);
  for(const result of [api.read(),api.setEnabled(true),api.setMode('quick'),api.markAttempt(),api.reset()]){
    assert.equal(result.ok,false);assert.equal(result.error.code,'CREDIT_PREFERENCES_UNAVAILABLE');assert.equal(JSON.stringify(result).includes('secret'),false);
  }
});
for(const operation of ['getItem','setItem','removeItem'])test(`${operation} failure is explicitly classified without erasing unrelated values`,()=>{
  const storage=memory(new Map([[keys.enabled,'1'],[keys.attempt,'123'],['other','retained']]));
  storage[operation]=()=>{throw new DOMException('controlled','QuotaExceededError')};const api=createCreditPreferences({storage});
  const result=operation==='getItem'?api.read():api.reset();assert.equal(result.ok,false);assert.equal(result.error.code,'CREDIT_PREFERENCES_QUOTA');assert.equal(storage.values.get('other'),'retained');
  if(operation==='removeItem')assert.equal(storage.values.get(keys.enabled),'0','partial reset starts with a saved disable');
});
for(const attempt of ['NaN','Infinity','-1','1.5','9007199254740992'])test(`invalid attempt ${attempt} fails closed and is retained`,()=>{
  const storage=memory(new Map([[keys.attempt,attempt]]));assert.deepEqual(createCreditPreferences({storage}).read(),{ok:false,error:{code:'CREDIT_PREFERENCES_INVALID',operation:'read'}});assert.equal(storage.values.get(keys.attempt),attempt);
});
test('invalid mode or clock input cannot write a misleading setting or cooldown',()=>{
  const storage=memory(),api=createCreditPreferences({storage,now:()=>NaN});assert.equal(api.setMode('garbage').ok,false);assert.equal(api.markAttempt().ok,false);assert.equal(storage.values.size,0);
});
