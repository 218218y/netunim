import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as createOrdersCloudAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as createKupaCloudAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';

function response(body,{status=200}={}){
  return {ok:status>=200&&status<300,status,async json(){return structuredClone(body)}};
}

async function withGlobals({fetchImpl,localStorageImpl},run){
  const previousFetch=globalThis.fetch,hadLocalStorage=Object.prototype.hasOwnProperty.call(globalThis,'localStorage'),previousLocalStorage=globalThis.localStorage;
  globalThis.fetch=fetchImpl;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:localStorageImpl});
  try{return await run()}finally{
    globalThis.fetch=previousFetch;
    if(hadLocalStorage)Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:previousLocalStorage});else delete globalThis.localStorage;
  }
}

const forbiddenStorage={
  getItem(){throw new Error('reset-only auth must not read localStorage')},
  setItem(){throw new Error('reset-only auth must not persist localStorage')},
  removeItem(){throw new Error('reset-only auth must not mutate localStorage')},
};

test('Orders reset-only Supabase auth ignores stale owner binding and keeps credentials ephemeral',async()=>{
  let ownerAssertions=0;const calls=[];
  await withGlobals({localStorageImpl:forbiddenStorage,fetchImpl:async(url,options={})=>{calls.push({url:String(url),options});return response({access_token:'reset-token',expires_in:3600,user:{email:'reset@example.test'}})}},async()=>{
    const auth=createOrdersCloudAuth({session:{},assertSessionOwner:()=>{ownerAssertions++;throw new Error('stale owner mismatch')}});
    const resetSession=await auth.authPasswordForLocalReset('reset@example.test','pw');
    assert.equal(resetSession.access_token,'reset-token');
    assert.equal(ownerAssertions,0);
    assert.equal(calls[0].options.method,'POST');
    await assert.rejects(()=>auth.localResetReadOnlyFetch(resetSession,'/rest/v1/rpc/unsafe'),/local_reset_read_only_path_rejected/);
  });
});

test('Kupa reset-only Supabase auth ignores stale owner binding and only exposes GET for verification',async()=>{
  let ownerAssertions=0;const calls=[];
  await withGlobals({localStorageImpl:forbiddenStorage,fetchImpl:async(url,options={})=>{calls.push({url:String(url),options});if(String(url).includes('/auth/v1/token'))return response({access_token:'reset-token',expires_in:3600,user:{email:'reset@example.test'}});return response([])}},async()=>{
    const auth=createKupaCloudAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=>'',setCloudHeaderStatus:()=>{},assertSessionOwner:()=>{ownerAssertions++;throw new Error('stale owner mismatch')}});
    const resetSession=await auth.supaAuthPasswordForLocalReset('reset@example.test','pw');
    assert.equal(resetSession.access_token,'reset-token');
    assert.equal(ownerAssertions,0);
    const read=await auth.localResetReadOnlyFetch(resetSession,'/rest/v1/kupa_documents?select=revision');
    assert.equal(read.ok,true);
    assert.equal(calls.at(-1).options.method,'GET');
    assert.equal(calls.at(-1).options.headers.Authorization,'Bearer reset-token');
  });
});
