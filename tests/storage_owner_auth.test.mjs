import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as createOrdersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as createKupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';

function memoryStorage(){
  const values=new Map();
  return {
    getItem:key=>values.has(String(key))?values.get(String(key)):null,
    setItem:(key,value)=>values.set(String(key),String(value)),
    removeItem:key=>values.delete(String(key)),
    clear:()=>values.clear(),
  };
}
function ownerFence(active){
  return (session,{allowMissing=false}={})=>{
    if(active.value==='local')return true;
    const auth=String(session?.user?.id||'').trim();
    if(!auth){if(allowMissing)return false;const error=new Error('storage_owner_reauth_required');error.code='storage_owner_reauth_required';throw error}
    if(auth!==active.value){const error=new Error('storage_owner_auth_mismatch');error.code='storage_owner_auth_mismatch';throw error}
    return true;
  };
}
function response(ok,body,status=ok?200:400){return {ok,status,headers:{get:()=>null},json:async()=>structuredClone(body),clone(){return response(ok,body,status)}}}
function sessionFor(id,extra={}){return {access_token:`access-${id}`,refresh_token:`refresh-${id}`,expires_in:3600,expires_at:1,user:{id},...extra}}

async function withGlobals(work){
  const priorStorage=globalThis.localStorage,priorFetch=globalThis.fetch,priorNavigator=globalThis.navigator;
  Object.defineProperty(globalThis,'localStorage',{value:memoryStorage(),configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  try{return await work()}finally{
    if(priorStorage===undefined)delete globalThis.localStorage;else Object.defineProperty(globalThis,'localStorage',{value:priorStorage,configurable:true,writable:true});
    if(priorFetch===undefined)delete globalThis.fetch;else globalThis.fetch=priorFetch;
    if(priorNavigator===undefined)delete globalThis.navigator;else Object.defineProperty(globalThis,'navigator',{value:priorNavigator,configurable:true,writable:true});
  }
}

test('Orders auth expiry clears credentials but cannot change the durable storage owner',async()=>withGlobals(async()=>{
  const active={value:'account-A'},assertSessionOwner=ownerFence(active),api=createOrdersAuth({session:{},assertSessionOwner});
  api.saveSession(sessionFor('account-A'));
  globalThis.fetch=async()=>response(false,{message:'invalid refresh token'},400);
  await assert.rejects(api.refreshSession(),/פג תוקף/);
  assert.equal(api.loadSession(),null);
  assert.equal(active.value,'account-A');

  globalThis.fetch=async()=>response(true,sessionFor('account-B'));
  await assert.rejects(api.authPassword('b@example.test','pw'),error=>error?.code==='storage_owner_auth_mismatch');
  assert.equal(api.loadSession(),null,'mismatched account must not become the active auth session');
  assert.equal(active.value,'account-A');

  globalThis.fetch=async()=>response(true,sessionFor('account-A'));
  const restored=await api.authPassword('a@example.test','pw');
  assert.equal(restored.user.id,'account-A');
  assert.equal(api.loadSession().user.id,'account-A');
}));

test('Kupa auth expiry clears credentials but cannot change the durable storage owner',async()=>withGlobals(async()=>{
  const active={value:'account-A'},assertSessionOwner=ownerFence(active),idb=new Map(),runtimeSession={};
  const api=createKupaAuth({
    session:runtimeSession,
    assertSessionOwner,
    idbGet:async(_store,key)=>idb.get(key)||null,
    idbPut:async(_store,key,value)=>{idb.set(key,structuredClone(value))},
    idbDelete:async(_store,key)=>{idb.delete(key)},
    supaProjectRef:()=> 'project',
    setCloudHeaderStatus:()=>{},
  });
  api.storeSupaSession(sessionFor('account-A'));
  globalThis.fetch=async()=>response(false,{message:'invalid refresh token'},400);
  await assert.rejects(api.supaRefresh(),/פג תוקף/);
  assert.equal(api.loadSupaSession(),null);
  assert.equal(active.value,'account-A');

  globalThis.fetch=async()=>response(true,sessionFor('account-B'));
  await assert.rejects(api.supaAuthPassword('b@example.test','pw'),error=>error?.code==='storage_owner_auth_mismatch');
  assert.equal(api.loadSupaSession(),null,'mismatched account must not become the active auth session');
  assert.equal(active.value,'account-A');

  globalThis.fetch=async()=>response(true,sessionFor('account-A'));
  const restored=await api.supaAuthPassword('a@example.test','pw');
  assert.equal(restored.user.id,'account-A');
  assert.equal(api.loadSupaSession().user.id,'account-A');
}));
