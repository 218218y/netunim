import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
import {createGoogleDriveClient} from '../netunim-orders/site/assets/js/shared/google-drive-client.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const credentials=id=>({access_token:'access-'+id,refresh_token:'refresh-'+id,expires_at:9999999999,user:{id}});
async function fixture(app,work){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousFetch=globalThis.fetch,values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  try{
    const auth=app==='orders'?ordersAuth({}):kupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},setCloudHeaderStatus:()=>{},supaProjectRef:()=> 'fixture'});
    const store=app==='orders'?auth.saveSession:auth.storeSupaSession;
    const authenticatedRequest=app==='orders'?auth.supaFetch:auth.supaRest;
    const drive=createGoogleDriveClient({accountScope:auth.getAccountScope,transport:{authenticatedRequest,fetchRequest:async()=>{throw Error('unexpected Drive data request')}},browser:{},clock:{now:()=>0}});
    store(credentials('A'));
    await work({auth,store,drive});
  }finally{
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;
    globalThis.fetch=previousFetch;
  }
}

for(const app of ['orders','kupa']){
  test(`${app} old OAuth disconnect cannot be reissued for a new account after HTTP 401`,async()=>fixture(app,async({store,drive})=>{
    const started=deferred(),release=deferred(),calls=[];let refreshes=0;
    globalThis.fetch=async(url,options)=>{
      if(url.includes('/auth/v1/token')){refreshes++;return new Response(JSON.stringify(credentials('B')))}
      calls.push({authorization:options.headers.Authorization,action:JSON.parse(options.body).action});
      if(calls.length===1){started.resolve();return release.promise}
      return new Response('{}');
    };
    const pending=assert.rejects(drive.disconnect(),error=>error.code==='GOOGLE_DRIVE_ACCOUNT_CHANGED');
    await started.promise;store(credentials('B'));release.resolve(new Response('{}',{status:401}));await pending;
    assert.deepEqual(calls,[{authorization:'Bearer access-A',action:'disconnect'}]);assert.equal(refreshes,0);
  }));

  test(`${app} old OAuth request cannot run after an awaited auth refresh and same-user relogin`,async()=>fixture(app,async({auth,store,drive})=>{
    const started=deferred(),release=deferred(),calls=[];store({...credentials('A'),expires_at:1});
    globalThis.fetch=async(url,options)=>{
      if(url.includes('/auth/v1/token')){started.resolve();return release.promise}
      calls.push(JSON.parse(options.body).action);return new Response('{}');
    };
    const pending=assert.rejects(drive.disconnect(),error=>error.code==='GOOGLE_DRIVE_ACCOUNT_CHANGED');
    await started.promise;store(null);store({...credentials('A'),access_token:'new-login-A'});release.resolve(new Response(JSON.stringify(credentials('A'))));await pending;
    assert.deepEqual(calls,[],'obsolete OAuth intent reached the new login after refresh');
    assert.equal((app==='orders'?auth.loadSession:auth.loadSupaSession)().access_token,'new-login-A','late refresh replaced the new login credentials');
  }));
}
