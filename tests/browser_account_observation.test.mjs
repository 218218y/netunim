import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthenticatedAccountScope} from '../shared/authenticated-account-scope.js';
import {createBrowserAccountObservation} from '../shared/browser-account-observation.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';

const raw=owner=>owner?JSON.stringify({user:{id:owner},access_token:'synthetic-'+owner}):null;
class Target{
  handlers=new Map();hidden=false;localStorage={};
  addEventListener(key,fn){if(!this.handlers.has(key))this.handlers.set(key,new Set());this.handlers.get(key).add(fn)}
  removeEventListener(key,fn){this.handlers.get(key)?.delete(fn)}
  send(key,event={}){for(const fn of this.handlers.get(key)||[])fn(event)}
  count(){return [...this.handlers.values()].reduce((sum,list)=>sum+list.size,0)}
}
function fixture(){
  let current=raw('A');const windowTarget=new Target(),documentTarget=new Target(),scope=createAuthenticatedAccountScope({loadSession:()=>JSON.parse(current)}),events=[];
  const observer=createBrowserAccountObservation({scope,sessionKey:'session',rereadSession:()=>JSON.parse(current),windowTarget,documentTarget});
  const off=observer.subscribe(value=>events.push(value));
  const write=(next,previous=current,key='session')=>{current=next;windowTarget.send('storage',{key,oldValue:previous,newValue:next,storageArea:windowTarget.localStorage})};
  return {scope,observer,events,off,write,windowTarget,documentTarget,set:value=>{current=value}};
}
test('completed authorization observers receive local logout and same-user relogin, not token refresh',()=>{
  const f=fixture(),before=f.scope.current();f.scope.replace(JSON.parse(raw('A')),{refresh:true});assert.equal(f.events.length,0);
  f.scope.replace(null);f.set(null);assert.equal(f.events.at(-1).owner,null);
  f.set(raw('A'));f.scope.replace(JSON.parse(raw('A')));assert.ok(f.scope.current().epoch>before.epoch);f.off();
});
test('cross-tab notifications reread live storage instead of adopting event credentials',()=>{
  const f=fixture();f.set(raw('B'));f.windowTarget.send('storage',{key:'session',oldValue:raw('A'),newValue:raw('obsolete-C'),storageArea:f.windowTarget.localStorage});
  assert.equal(f.scope.current().owner,'B');assert.equal(f.events.at(-1).owner,'B');f.off();
});
test('queued logout and relogin invalidate old A even when live storage already contains A',()=>{
  const f=fixture(),before=f.scope.current();f.set(raw('A'));
  f.windowTarget.send('storage',{key:'session',oldValue:raw('A'),newValue:null});
  f.windowTarget.send('storage',{key:'session',oldValue:null,newValue:raw('A')});
  assert.equal(f.scope.current().owner,'A');assert.ok(f.scope.current().epoch>before.epoch);assert.equal(f.events.length,2);f.off();
});
test('same-owner cross-tab refresh preserves epoch while storage clear invalidates it',()=>{
  const f=fixture(),before=f.scope.current();f.write(raw('A'));assert.deepEqual(f.scope.current(),before);assert.equal(f.events.length,0);
  f.write(null,raw('A'),null);assert.equal(f.events.at(-1).owner,null);f.off();
});
test('unrelated preferences and sessionStorage events cannot replace authority',()=>{
  const f=fixture();f.windowTarget.send('storage',{key:'other',newValue:null});f.windowTarget.send('storage',{key:'session',storageArea:{},newValue:null});assert.equal(f.events.length,0);f.off();
});
test('visible/focus rechecks detect missed owner changes without resetting a stable scope',()=>{
  const f=fixture(),before=f.scope.current();f.windowTarget.send('focus');assert.deepEqual(f.scope.current(),before);
  f.set(raw('B'));f.documentTarget.hidden=true;f.documentTarget.send('visibilitychange');assert.equal(f.events.length,0);
  f.documentTarget.hidden=false;f.documentTarget.send('visibilitychange');assert.equal(f.events.at(-1).owner,'B');f.off();
});
test('100 subscribe/dispose cycles own exactly three browser listeners and no credential writes',()=>{
  const f=fixture();f.off();for(let index=0;index<100;index++){
    const one=f.observer.subscribe(()=>{}),two=f.observer.subscribe(()=>{});assert.equal(f.windowTarget.count()+f.documentTarget.count(),3);
    one();one();assert.equal(f.windowTarget.count()+f.documentTarget.count(),3);two();assert.equal(f.windowTarget.count()+f.documentTarget.count(),0);
  }
});
for(const app of ['kupa','orders'])test(`${app} production auth invalidates cached session on an external logout without IDB writes`,()=>{
  const keys=['window','document','localStorage'],old=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key)),windowTarget=new Target(),documentTarget=new Target(),values=new Map(),writes=[];
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};windowTarget.localStorage=storage;
  for(const [key,value] of [['window',windowTarget],['document',documentTarget],['localStorage',storage]])Object.defineProperty(globalThis,key,{configurable:true,value});
  try{
    const auth=app==='kupa'?kupaAuth({session:{},idbPut:async(...args)=>writes.push(args),idbDelete:async(...args)=>writes.push(args)}):ordersAuth({});
    const store=app==='kupa'?auth.storeSupaSession:auth.saveSession,key=app==='kupa'?'kupa.supabase.session.v1':'orders.supabase.session.v1';
    store(JSON.parse(raw('A')));const before=auth.getAccountScope(),events=[],off=auth.subscribeAccountScope(value=>events.push(value)),count=writes.length;
    values.delete(key);windowTarget.send('storage',{key,oldValue:raw('A'),newValue:null,storageArea:storage});
    assert.equal(auth.getAccountScope().owner,null);assert.ok(auth.getAccountScope().epoch>before.epoch);assert.equal(events.at(-1).owner,null);assert.equal(writes.length,count);
    off();assert.equal(windowTarget.count()+documentTarget.count(),0);
    store(JSON.parse(raw('A')));const seen=[];
    const close=auth.subscribeAccountScope(value=>seen.push({event:value,live:auth.getAccountScope()}));
    store(JSON.parse(raw('B')));
    assert.equal(seen.length,1,'one completed credential replacement emits one coherent identity');
    assert.equal(seen[0].event.owner,'B');assert.deepEqual(seen[0].live,seen[0].event);close();
  }finally{keys.forEach((key,index)=>old[index]?Object.defineProperty(globalThis,key,old[index]):delete globalThis[key])}
});
