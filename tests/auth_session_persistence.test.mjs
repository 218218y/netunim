import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthSessionPersistence} from '../netunim-kupa/site/assets/js/cloud/session-store.js';
import {createCloudAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
import {SUPA_SESSION_KEY,SUPA_SESSION_IDB_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';

const authSession=id=>({user:{id},access_token:`access-${id}`,refresh_token:`refresh-${id}`,expires_at:9999999999});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(){
  const values=new Map(),idb=new Map(),errors=[],calls=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  const mirror={read:async()=>idb.get('session')??null,write:async value=>{calls.push(['write',value.user.id]);idb.set('session',value)},remove:async()=>{calls.push(['delete']);idb.delete('session')}};
  const create=()=>createAuthSessionPersistence({key:'session',initial:null,storage:()=>storage,decode:value=>value&&typeof value==='object'?value:null,mirror,report:error=>errors.push(error)});
  return {values,idb,storage,mirror,calls,errors,create};
}

test('failed IDB logout deletion cannot restore old credentials after reload',async()=>{
  const f=fixture(),owner=f.create();owner.store(authSession('A'));await owner.drain();
  f.mirror.remove=async()=>{throw Error('delete failed')};
  owner.store(null);await owner.drain();
  assert.equal(f.idb.get('session').user.id,'A');assert.equal(f.errors.length,1);
  assert.equal(f.values.get('session'),'null');assert.equal(await f.create().restore(),null);
});

test('a delayed write cannot overtake logout and a later account login',async()=>{
  const f=fixture(),gate=deferred(),started=deferred();
  const write=f.mirror.write;f.mirror.write=async value=>{if(value.user.id==='A'){started.resolve();await gate.promise}await write(value)};
  const owner=f.create();const a=authSession('A');owner.store(a);a.user.id='mutated';await started.promise;
  owner.store(null);owner.store(authSession('B'));
  assert.equal((await f.create().restore()).user.id,'B');assert.equal(f.calls.length,0);
  gate.resolve();await owner.drain();
  assert.deepEqual(f.calls,[['write','A'],['delete'],['write','B']]);assert.equal(f.idb.get('session').user.id,'B');
});

for(const action of ['logout','login'])test(`late historical restore cannot override ${action}`,async()=>{
  const f=fixture(),gate=deferred();f.mirror.read=()=>gate.promise;
  const owner=f.create(),restoring=owner.restore();
  owner.store(action==='logout'?null:authSession('B'));gate.resolve(authSession('A'));
  assert.equal((await restoring)?.user.id??null,action==='logout'?null:'B');await owner.drain();
});

test('late historical restore rereads another instance before adoption',async()=>{
  const f=fixture(),gate=deferred();f.mirror.read=()=>gate.promise;
  const previous=f.create(),restoring=previous.restore(),next=f.create();next.store(null);
  gate.resolve(authSession('A'));assert.equal(await restoring,null);await next.drain();
});

test('legacy IDB credentials migrate once; malformed or unavailable local storage never falls back',async()=>{
  const f=fixture();f.idb.set('session',authSession('A'));const owner=f.create();
  assert.equal((await owner.restore()).user.id,'A');await owner.drain();
  assert.equal(JSON.parse(f.values.get('session')).user.id,'A');
  f.values.set('session','broken');assert.equal(await f.create().restore(),null);
  f.storage.getItem=()=>{throw Error('read unavailable')};assert.equal(await f.create().restore(),null);
});

test('failure to persist logout revokes memory and reports failure synchronously',async()=>{
  const f=fixture(),owner=f.create();owner.store(authSession('A'));await owner.drain();
  f.storage.setItem=()=>{throw Error('write unavailable')};
  assert.throws(()=>owner.store(null),{code:'cloud_session_persistence_failed'});assert.equal(owner.load(),null);
});

async function production(t){
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map(),idb=new Map(),errors=[];
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage});
  t.after(()=>{if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator});
  t.mock.method(console,'error',(...args)=>errors.push(args));
  const ports={session:{},idbGet:async(_store,key)=>idb.get(key)??null,idbPut:async(_store,key,value)=>idb.set(key,value),idbDelete:async(_store,key)=>idb.delete(key),supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}};
  return {ports,values,idb,errors,create:()=>createCloudAuth({...ports,session:{}})};
}

test('production Kupa auth keeps logout final when the historical mirror survives',async t=>{
  const f=await production(t);f.idb.set(SUPA_SESSION_IDB_KEY,authSession('A'));
  f.ports.idbDelete=async()=>{throw Error('delete aborted')};const auth=f.create();
  await auth.restoreSupaSession();auth.storeSupaSession(null);
  for(let turn=0;turn<10;turn++)await Promise.resolve();
  assert.equal(f.values.get(SUPA_SESSION_KEY),'null');assert.equal(await f.create().restoreSupaSession(),null);assert.ok(f.errors.length);
});

for(const success of [true,false])test(`logout during token refresh fences a late ${success?'success':'failure'}`,async t=>{
  const f=await production(t),auth=f.create(),gate=deferred();auth.storeSupaSession(authSession('A'));
  t.mock.method(globalThis,'fetch',()=>gate.promise);
  const pending=assert.rejects(auth.supaRefresh(),{code:'cloud_auth_scope_changed'});auth.storeSupaSession(null);
  gate.resolve(Response.json(success?authSession('A'):{message:'expired'},{status:success?200:400}));await pending;
  assert.equal(auth.loadSupaSession(),null);assert.equal(await f.create().restoreSupaSession(),null);
});

test('refresh flights belong to one auth instance and login epoch',async t=>{
  const f=await production(t),one=f.create(),two=f.create(),gate=deferred(),calls=[];
  one.storeSupaSession(authSession('A'));two.storeSupaSession(authSession('A'));
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls.push(JSON.parse(options.body).refresh_token);if(calls.length===1)return gate.promise;return Response.json(authSession('A'))});
  const pending=one.supaRefresh();await two.supaRefresh();assert.deepEqual(calls,['refresh-A','refresh-A']);
  gate.resolve(Response.json(authSession('A')));await pending;
});

test('a new login starts its own refresh while the obsolete flight drains',async t=>{
  const f=await production(t),auth=f.create(),gate=deferred();auth.storeSupaSession(authSession('A'));
  t.mock.method(globalThis,'fetch',async(_url,options)=>JSON.parse(options.body).refresh_token==='refresh-A'?gate.promise:Response.json(authSession('B')));
  const old=assert.rejects(auth.supaRefresh(),{code:'cloud_auth_scope_changed'});
  auth.storeSupaSession(null);auth.storeSupaSession(authSession('B'));
  assert.equal((await auth.supaRefresh()).user.id,'B');gate.resolve(Response.json(authSession('A')));await old;
  assert.equal(auth.loadSupaSession().user.id,'B');
});

test('refresh waiting for a browser lock cannot start under a later login',async t=>{
  const f=await production(t),auth=f.create(),gate=deferred();let requests=0;
  navigator.locks={request:async(_key,_options,work)=>{await gate.promise;return work()}};
  t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json(authSession('A'))});
  auth.storeSupaSession(authSession('A'));const old=assert.rejects(auth.supaRefresh(),{code:'cloud_auth_scope_changed'});
  auth.storeSupaSession(null);auth.storeSupaSession(authSession('B'));gate.resolve();await old;
  assert.equal(requests,0);assert.equal(auth.loadSupaSession().user.id,'B');
});

test('missed cross-tab notifications cannot let a former account refresh overwrite the current one',async t=>{
  const f=await production(t),auth=f.create(),other=f.create(),gate=deferred();auth.storeSupaSession(authSession('A'));
  t.mock.method(globalThis,'fetch',()=>gate.promise);const old=assert.rejects(auth.supaRefresh(),{code:'cloud_auth_scope_changed'});
  other.storeSupaSession(authSession('B'));gate.resolve(Response.json(authSession('A')));await old;
  assert.equal(auth.loadSupaSession().user.id,'B');assert.equal((await f.create().restoreSupaSession()).user.id,'B');
});

test('an obsolete password response cannot undo logout or replace a newer login',async t=>{
  const f=await production(t),auth=f.create(),gate=deferred();
  t.mock.method(globalThis,'fetch',()=>gate.promise);
  const pending=assert.rejects(auth.supaAuthPassword('a@example.test','fixture'),{code:'cloud_auth_scope_changed'});
  auth.storeSupaSession(null);auth.storeSupaSession(authSession('B'));gate.resolve(Response.json(authSession('A')));await pending;
  assert.equal(auth.loadSupaSession().user.id,'B');assert.equal((await f.create().restoreSupaSession()).user.id,'B');
});
