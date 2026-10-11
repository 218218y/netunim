import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as createOrdersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as createKupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const credentials=(owner,accessToken=`token-${owner}`)=>({access_token:accessToken,refresh_token:`refresh-${owner}`,expires_at:9_999_999_999,user:{id:owner}});

for(const [app,create] of [['orders',createOrdersAuth],['kupa',createKupaAuth]]){
  for(const transition of ['account switch','same-user relogin']){
    test(`${app}: in-flight Data API GET cannot be reused by ${transition}`,async()=>{
      const oldFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
      Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
      const auth=app==='orders'?create({}):create({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
      const save=app==='orders'?auth.saveSession:auth.storeSupaSession,request=app==='orders'?auth.supaFetch:auth.supaRest;
      const started=deferred(),firstResponse=deferred(),seen=[];
      globalThis.fetch=async(_url,options)=>{
        const token=options?.headers?.Authorization;
        seen.push(token);
        if(seen.length===1){started.resolve();return firstResponse.promise}
        return Response.json({token});
      };
      try{
        save(credentials('owner-A'));const old=request('/rest/v1/example_document?select=state',{method:'GET'});
        await started.promise;
        const nextCredentials=transition==='account switch'?credentials('owner-B'):credentials('owner-A','relogin-A');
        save(nextCredentials);
        const newest=request('/rest/v1/example_document?select=state',{method:'GET'});
        firstResponse.resolve(Response.json({token:'Bearer token-owner-A'}));
        const oldOutcome=await old.then(async response=>({value:await response.json()}),error=>({error}));
        const latest=await newest.then(response=>response.json());
        assert.equal(oldOutcome.error?.code,'cloud_auth_scope_changed','obsolete account response must not complete normally');
        assert.equal(latest.token,`Bearer ${nextCredentials.access_token}`,'new login must make its own authorized request');
        assert.deepEqual(seen,['Bearer token-owner-A',`Bearer ${nextCredentials.access_token}`]);
      }finally{
        globalThis.fetch=oldFetch;
        if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
      }
    });
  }
}

for(const [app,create] of [['orders',createOrdersAuth],['kupa',createKupaAuth]]){
  test(`${app}: a queued mutation cannot execute under a replacement account`,async()=>{
    const oldFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
    const auth=app==='orders'?create({}):create({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
    const save=app==='orders'?auth.saveSession:auth.storeSupaSession,request=app==='orders'?auth.supaFetch:auth.supaRest;
    const started=deferred(),release=deferred(),seen=[];
    globalThis.fetch=async(url,options)=>{
      seen.push({path:new URL(url).pathname,token:options.headers.Authorization});
      if(seen.length===1){started.resolve();return release.promise}
      return Response.json({ok:true});
    };
    try{
      save(credentials('owner-A'));
      const oldRead=request('/rest/v1/held',{method:'GET'});
      await started.promise;
      const pendingWrite=request('/rest/v1/rpc/save_v6',{method:'POST',body:'{}'});
      save(credentials('owner-B'));
      release.resolve(Response.json({ok:true}));
      await assert.rejects(oldRead,{code:'cloud_auth_scope_changed'});
      await assert.rejects(pendingWrite,{code:'cloud_auth_scope_changed'});
      assert.deepEqual(seen,[{path:'/rest/v1/held',token:'Bearer token-owner-A'}],'stale queued write must not be dispatched under B');
      assert.equal((await request('/rest/v1/healthy',{method:'GET'})).ok,true);
      assert.equal(seen.at(-1).token,'Bearer token-owner-B');
    }finally{
      globalThis.fetch=oldFetch;
      if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
    }
  });
}

for(const [app,create] of [['orders',createOrdersAuth],['kupa',createKupaAuth]]){
  test(`${app}: a cancelled read owner cannot make a newer read fail through coalescing`,async()=>{
    const oldFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
    const auth=app==='orders'?create({}):create({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
    const save=app==='orders'?auth.saveSession:auth.storeSupaSession,request=app==='orders'?auth.supaFetch:auth.supaRest;
    const started=deferred(),release=deferred();let calls=0,oldValid=true;
    globalThis.fetch=async()=>{
      calls++;
      if(calls===1){started.resolve();return release.promise}
      return Response.json({new:true});
    };
    try{
      save(credentials('owner-A'));
      const older=request('/rest/v1/example_document?select=state',{method:'GET',assertRequestScope:()=>{if(!oldValid)throw Object.assign(new Error('obsolete read'),{code:'obsolete_read'})}});
      await started.promise;
      const newer=request('/rest/v1/example_document?select=state',{method:'GET',assertRequestScope:()=>{}});
      oldValid=false;release.resolve(Response.json({old:true}));
      await assert.rejects(older,{code:'obsolete_read'});
      assert.deepEqual(await newer.then(response=>response.json()),{new:true});
      assert.equal(calls,2);
    }finally{
      globalThis.fetch=oldFetch;
      if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
    }
  });
}
