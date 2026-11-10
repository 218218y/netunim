import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAuth as createOrdersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as createKupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
import {normalizeCloudError} from '../shared/cloud-sync.js';
import {MIN_SYNC_CAPABILITIES} from '../shared/sync-capabilities.js';

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
  globalThis.fetch=async()=>response(false,{error_code:'refresh_token_not_found'},400);
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
  globalThis.fetch=async()=>response(false,{error_code:'refresh_token_already_used'},400);
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

for(const app of ['orders','kupa'])test(`${app} temporary Auth failures preserve the existing login and allow recovery`,async()=>withGlobals(async()=>{
  const api=app==='orders'?createOrdersAuth({}):createKupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
  const store=app==='orders'?api.saveSession:api.storeSupaSession;
  const load=app==='orders'?api.loadSession:api.loadSupaSession;
  const refresh=app==='orders'?api.refreshSession:api.supaRefresh;
  const existing=sessionFor('A');
  store(existing);
  const scope=api.getAccountScope();
  for(const [status,kind] of [[400,'service_unavailable'],[401,'service_unavailable'],[403,'service_unavailable'],
    [408,'timeout'],[429,'rate_limited'],[500,'service_unavailable'],[503,'service_unavailable']]){
    // A terminal-looking body from a failing gateway must not clear the login.
    const body=status===503?{error_code:'refresh_token_not_found'}:{message:'untrusted auth details'};
    globalThis.fetch=async()=>response(false,body,status);
    await assert.rejects(refresh(),error=>error.status===status&&normalizeCloudError(error).kind===kind&&!error.message.includes('untrusted'));
    assert.deepEqual(load(),existing);
    assert.deepEqual(api.getAccountScope(),scope);
  }
  globalThis.fetch=async()=>response(false,{error_code:'conflict'},409);
  await assert.rejects(refresh(),error=>normalizeCloudError(error).kind==='service_unavailable');
  globalThis.fetch=async()=>new Response('not JSON',{status:200});
  await assert.rejects(refresh(),{code:'SUPABASE_AUTH_REFRESH_UNAVAILABLE'});
  assert.deepEqual(load(),existing);
  for (const invalid of [{}, sessionFor('B'), sessionFor('A',{refresh_token:''})]) {
    globalThis.fetch=async()=>response(true,invalid);
    await assert.rejects(refresh(),{code:'SUPABASE_AUTH_REFRESH_UNAVAILABLE'});
    assert.deepEqual(load(),existing);
  }
  globalThis.fetch=async()=>response(true,sessionFor('A',{access_token:'refreshed-A'}));
  assert.equal((await refresh()).access_token,'refreshed-A');
  assert.deepEqual(api.getAccountScope(),scope);
}));

function authTab(app){
  if(app==='orders'){
    const api=createOrdersAuth({});
    return {store:api.saveSession,load:api.loadSession,refresh:api.refreshSession,request:api.supaFetch};
  }
  const api=createKupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
  return {store:api.storeSupaSession,load:api.loadSupaSession,refresh:api.supaRefresh,request:api.supaRest};
}

function serialBrowserLock(){
  let tail=Promise.resolve();
  navigator.locks={request(_key,_options,work){
    const result=tail.then(work);
    tail=result.catch(()=>{});
    return result;
  }};
}

for(const app of ['orders','kupa']){
  for(const stalledAt of ['headers','body'])test(`${app} refresh deadline releases the lock while waiting for ${stalledAt}`,async t=>withGlobals(async()=>{
    t.mock.timers.enable({apis:['setTimeout']});
    serialBrowserLock();
    const {store,load,refresh}=authTab(app);
    const existing=sessionFor('A');
    store(existing);
    const late=Promise.withResolvers(),started=Promise.withResolvers();
    let signal,attempts=0;
    globalThis.fetch=async(_url,options)=>{
      signal=options.signal;
      attempts++;
      if(stalledAt==='headers'){started.resolve();return late.promise}
      return {ok:true,json(){started.resolve();return late.promise}};
    };
    const pending=assert.rejects(refresh(),{code:'SUPABASE_NETWORK_TIMEOUT'});
    await started.promise;
    assert.equal(signal.aborted,false);
    t.mock.timers.tick(20_000);
    await pending;
    assert.equal(signal.aborted,true);
    assert.equal(attempts,1);
    assert.deepEqual(load(),existing);

    const recovered=sessionFor('A',{access_token:'new-access',refresh_token:'new-refresh'});
    globalThis.fetch=async()=>Response.json(recovered);
    assert.equal((await refresh()).access_token,'new-access');
    const current=load();
    late.resolve(stalledAt==='headers'?Response.json(existing):existing);
    await new Promise(setImmediate);
    assert.deepEqual(load(),current);
  }));

  test(`${app} two tabs use the same rotation receipt`,async()=>withGlobals(async()=>{
    serialBrowserLock();
    const first=authTab(app),second=authTab(app);
    first.store(sessionFor('A'));
    const receipt=Promise.withResolvers();
    let attempts=0;
    globalThis.fetch=()=>{attempts++;return receipt.promise};
    const pending=[first.refresh(),second.refresh()];
    receipt.resolve(Response.json(sessionFor('A',{access_token:'rotated-access',refresh_token:'rotated-refresh'})));
    assert.deepEqual((await Promise.all(pending)).map(result=>result.refresh_token),['rotated-refresh','rotated-refresh']);
    assert.equal(attempts,1);
  }));

  test(`${app} a lost rotation receipt preserves the active token's parent for later recovery`,async t=>withGlobals(async()=>{
    t.mock.timers.enable({apis:['Date']});
    serialBrowserLock();
    const {store,load,refresh}=authTab(app);
    const parent=sessionFor('A');
    const active=sessionFor('A',{access_token:'rotated-access',refresh_token:'rotated-refresh'});
    store(parent);
    const presented=[];
    let serverActive=parent;
    globalThis.fetch=async(_url,{body})=>{
      const token=JSON.parse(body).refresh_token;
      presented.push(token);
      assert.equal(token,parent.refresh_token);
      if(serverActive===parent){
        serverActive=active;
        throw new TypeError('rotation committed but response was lost');
      }
      // Supabase returns the active token for its direct parent, even after
      // the normal reuse interval has expired.
      return Response.json(serverActive);
    };
    await assert.rejects(refresh(),{code:'SUPABASE_NETWORK_UNAVAILABLE'});
    assert.deepEqual(presented,[parent.refresh_token]);
    assert.deepEqual(load(),parent);
    t.mock.timers.tick(30_000);
    assert.equal((await refresh()).refresh_token,active.refresh_token);
    assert.equal(load().refresh_token,active.refresh_token);
    assert.deepEqual(presented,[parent.refresh_token,parent.refresh_token]);
  }));

  test(`${app} reconnect sends a cloud operation once after refreshing its expired session`,async t=>withGlobals(async()=>{
    t.mock.timers.enable({apis:['Date']});
    const {store,load,request}=authTab(app),existing=sessionFor('A');
    store(existing);
    const calls=[];
    let online=false;
    globalThis.fetch=async(url,options)=>{
      if(url.includes('grant_type=refresh_token')){
        calls.push('refresh');
        if(!online)throw new TypeError('failed to fetch');
        return Response.json(sessionFor('A',{access_token:'new-access',refresh_token:'new-refresh'}));
      }
      if(url.endsWith('/rpc/get_netunim_sync_capabilities'))return Response.json(MIN_SYNC_CAPABILITIES);
      calls.push(options.headers.Authorization);
      return Response.json({ok:true});
    };
    const send=()=>request('/rest/v1/example',{method:'POST',body:'{}'});
    await assert.rejects(send(),{code:'SUPABASE_NETWORK_UNAVAILABLE'});
    assert.deepEqual(load(),existing);
    assert.deepEqual(calls,['refresh']);
    online=true;
    t.mock.timers.tick(15_000);
    assert.equal((await send()).ok,true);
    assert.deepEqual(calls,['refresh','refresh','Bearer new-access']);
  }));
}

test('Orders refresh waiting for the browser lock cannot run under a newer login',async()=>withGlobals(async()=>{
  const api=createOrdersAuth({});
  let release,requests=0;
  const gate=new Promise(resolve=>{release=resolve});
  navigator.locks={request:async(_key,_options,work)=>{await gate;return work()}};
  globalThis.fetch=async(_url,options)=>{
    requests++;
    return response(true,sessionFor(JSON.parse(options.body).refresh_token.slice(-1)));
  };
  api.saveSession(sessionFor('A'));
  const old=assert.rejects(api.refreshSession(),{code:'cloud_auth_scope_changed'});
  api.saveSession(null);
  api.saveSession(sessionFor('B'));
  release();
  await old;
  assert.equal(requests,0);
  assert.equal((await api.refreshSession()).user.id,'B');
  assert.equal(requests,1);
}));

for(const app of ['orders','kupa'])test(`${app} a late rejection cannot erase a replacement credential for the same user`,async()=>withGlobals(async()=>{
  const make=()=>app==='orders'?createOrdersAuth({}):createKupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
  const first=make(),other=make();
  const store=app==='orders'?'saveSession':'storeSupaSession';
  const load=app==='orders'?'loadSession':'loadSupaSession';
  const refresh=app==='orders'?'refreshSession':'supaRefresh';
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  first[store](sessionFor('A'));
  globalThis.fetch=()=>pending;
  const stale=assert.rejects(first[refresh](),{code:'cloud_auth_scope_changed'});
  const replacement=sessionFor('A',{refresh_token:'replacement'});
  other[store](replacement);
  release(response(false,{code:'refresh_token_not_found'},400));
  await stale;
  assert.deepEqual(first[load](),replacement);
}));

for(const app of ['orders','kupa'])test(`${app} auth scope survives refresh and fences logout plus same-user login`,async()=>withGlobals(async()=>{
  const api=app==='orders'?createOrdersAuth({}):createKupaAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
  const store=app==='orders'?api.saveSession:api.storeSupaSession;
  const refresh=app==='orders'?api.refreshSession:api.supaRefresh;
  const login=app==='orders'?api.authPassword:api.supaAuthPassword;
  store(sessionFor('A'));const initial=api.getAccountScope();
  globalThis.fetch=async()=>response(true,sessionFor('A',{access_token:'refreshed-A'}));
  await refresh();assert.deepEqual(api.getAccountScope(),initial,'access-token refresh must preserve active Drive work');
  store(null);await login('a@example.test','fixture');const next=api.getAccountScope();
  assert.equal(next.owner,'A');assert.ok(next.epoch>initial.epoch,'logout/login must fence earlier requests even without an intervening scope read');
}));

for(const app of ['orders','kupa'])for(const success of [false,true])test(`${app} obsolete refresh ${success?'success':'failure'} preserves a newer account session`,async()=>withGlobals(async()=>{
  const active={value:'A'},assertSessionOwner=ownerFence(active);
  const api=app==='orders'?createOrdersAuth({assertSessionOwner}):createKupaAuth({assertSessionOwner,session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
  const store=app==='orders'?api.saveSession:api.storeSupaSession,refresh=app==='orders'?api.refreshSession:api.supaRefresh;
  let release,entered;const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
  store(sessionFor('A'));globalThis.fetch=async()=>{entered();return gate};
  const pending=assert.rejects(refresh(),error=>error.code==='cloud_auth_scope_changed');await started;
  active.value='B';store(sessionFor('B'));const scope=api.getAccountScope();
  release(response(success,success?sessionFor('A'):{message:'invalid refresh token'}));await pending;
  assert.deepEqual(api.getAccountScope(),scope);assert.equal((app==='orders'?api.loadSession:api.loadSupaSession)().user.id,'B');
}));
