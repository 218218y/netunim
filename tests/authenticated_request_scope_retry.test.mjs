import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';

for(const app of ['kupa','orders'])test(`${app} bounded network retry revalidates the original request scope`,async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map(),timers=new Map();let calls=0,next=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage});
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id});t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const auth=app==='orders'?ordersAuth({}):kupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},setCloudHeaderStatus:()=>{},supaProjectRef:()=> 'fixture'});
  const store=app==='orders'?auth.saveSession:auth.storeSupaSession,request=app==='orders'?auth.supaFetch:auth.supaRest;
  store({user:{id:'A'},access_token:'fixture-A',expires_at:9999999999});const observed=auth.getAccountScope();
  const assertRequestScope=()=>{const live=auth.getAccountScope();if(live.owner!==observed.owner||live.epoch!==observed.epoch)throw Object.assign(new Error('former operation scope'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  t.mock.method(globalThis,'fetch',async()=>{calls++;if(calls===1)throw new TypeError('Failed to fetch');return new Response('{}')});
  const pending=request('/functions/v1/fixture-operation',{method:'POST',networkRetry:true,assertRequestScope});
  for(let i=0;i<30;i++)await Promise.resolve();assert.equal(calls,1);assert.equal(timers.size,2);
  store(null);store({user:{id:'A'},access_token:'new-login-A',expires_at:9999999999});
  const retry=[...timers.values()].sort((a,b)=>a.delay-b.delay)[0];retry.callback();
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(calls,1);assert.equal(timers.size,1);
});
