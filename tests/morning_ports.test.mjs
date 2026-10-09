import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningOperationScope} from '../netunim-orders/site/assets/js/core/morning-operation-scope.js';
import {createMorningRequest} from '../netunim-orders/site/assets/js/integrations/morning.js';
import {createMorningIssuance} from '../netunim-orders/site/assets/js/domains/customers/morning-issuance.js';
import {createMorningLifetime} from '../netunim-orders/site/assets/js/domains/customers/morning-lifetime.js';

const changed={code:'MORNING_OPERATION_SCOPE_CHANGED'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function authority(){const live={account:{owner:'A',epoch:1},storageOwner:'A',readable:true,writable:true};return {live,scope:createMorningOperationScope({readAccess:()=>live})}}
for(const change of ['logout','account','relogin','primary','storage','readiness'])test(`Morning immutable write authority rejects ${change}`,()=>{
  const {live,scope}=authority(),receipt=scope.capture();receipt();
  if(change==='logout')live.account.owner=null;
  if(change==='account')live.account.owner=live.storageOwner='B';
  if(change==='relogin')live.account.epoch++;
  if(change==='primary')live.writable=false;
  if(change==='storage')live.storageOwner='local';
  if(change==='readiness')live.readable=live.writable=false;
  assert.throws(receipt,changed);if(change==='relogin'||change==='account')assert.doesNotThrow(scope.capture);else assert.throws(scope.capture,changed);
});
test('read authority permits a readable secondary tab, write authority does not',()=>{
  const {live,scope}=authority(),read=scope.captureRead();live.writable=false;read();assert.throws(scope.capture,changed);
  live.readable=false;assert.throws(read,changed);
});
for(const action of ['json','pdf'])for(const boundary of ['headers','body'])test(`Morning ${action} rejects old login during ${boundary}`,async()=>{
  const {live,scope}=authority(),entered=deferred(),release=deferred();let options;
  const client=createMorningRequest({operationScope:scope,supaFetch:async(_path,opts)=>{
    options=opts;if(boundary==='headers'){entered.resolve();await release.promise}
    const body=async()=>{if(boundary==='body'){entered.resolve();await release.promise}return action==='json'?{ok:true}:new Blob(['%PDF-fixture'])};
    return {ok:true,headers:new Headers({'Content-Type':'application/pdf'}),json:body,blob:body};
  }});
  const pending=action==='json'?client.json('status'):client.pdf('official');await entered.promise;live.account.epoch++;release.resolve();
  await assert.rejects(pending,changed);assert.equal(options.networkRetry,false);assert.throws(options.assertRequestScope,changed);
});
test('JSON reader preserves explicit server rejection and fails closed on malformed bodies',async()=>{
  const {scope}=authority();let result;
  const client=createMorningRequest({operationScope:scope,supaFetch:async()=>result});
  result=new Response(JSON.stringify({ok:false,code:'uncertain',uncertain:true}),{status:503});
  await assert.rejects(client.json('create'),error=>error.code==='uncertain'&&error.status===503&&error.details.uncertain);
  for(const body of ['null','[]','broken']){result=new Response(body);await assert.rejects(client.json('status'),{code:'morning_response_invalid'})}
});
test('reservation cannot persist or issue after the account changes',async()=>{
  const {live,scope}=authority(),entered=deferred(),release=deferred(),calls=[];
  const issuer=createMorningIssuance({backend:async action=>{calls.push(action);entered.resolve();await release.promise;return {reserved:true,operation:{state:'reserved'}}},recovery:{persist(){assert.fail('stale persist')},reset(){assert.fail('stale reset')},block(){}}});
  const pending=issuer.issue({operation_id:'same-id'},{operationId:'same-id'},scope.capture());await entered.promise;live.account.epoch++;release.resolve();
  await assert.rejects(pending,changed);assert.deepEqual(calls,['reserve']);
});
test('lost official response retains exact recovery before create and never retries automatically',async()=>{
  const {scope}=authority(),calls=[],context={operationId:'same-id'};let retained;
  const issuer=createMorningIssuance({backend:async(action,payload)=>{calls.push([action,payload.operation_id]);if(action==='reserve')return {reserved:true,operation:{state:'reserved'}};assert.equal(retained,context);throw Error('server committed, response lost')},recovery:{persist:value=>{retained=value},reset(){assert.fail('cannot erase uncertain issue')},block(){}}});
  await assert.rejects(issuer.issue({operation_id:'same-id'},context,scope.capture()),/response lost/);
  assert.equal(retained,context);assert.deepEqual(calls,[['reserve','same-id'],['create','same-id']]);
});
test('failure to persist recovery abandons only the current reservation and never creates',async()=>{
  const {scope}=authority(),calls=[];let reset;
  const issuer=createMorningIssuance({backend:async action=>{calls.push(action);return action==='reserve'?{reserved:true,operation:{state:'reserved'}}:{abandoned:true}},recovery:{persist(){throw Error('quota')},reset:id=>{reset=id},block(){}}});
  await assert.rejects(issuer.issue({operation_id:'same-id'},{operationId:'same-id'},scope.capture()),/quota/);
  assert.deepEqual(calls,['reserve','abandon_reservation']);assert.equal(reset,'same-id');
});
test('old task finally cannot clear a new login task, same-authority callers coalesce',async()=>{
  const {live,scope}=authority(),old=deferred(),fresh=deferred();
  const lifetime=createMorningLifetime({operationScope:scope,getPendingOperationId:()=>'',recover(){},onInterrupt(){},events:{}});
  const first=lifetime.join('recovery',scope.capture(),()=>old.promise);assert.equal(lifetime.join('recovery',scope.capture(),()=>assert.fail()),first);
  live.account.epoch++;const second=lifetime.join('recovery',scope.capture(),()=>fresh.promise);assert.notEqual(first,second);
  old.resolve();await first;assert.equal(lifetime.pending('recovery'),true);fresh.resolve();await second;assert.equal(lifetime.pending('recovery'),false);lifetime.dispose();
});
test('100 lifetime cycles remove listeners, coalesce wakes and fence stale callbacks',async()=>{
  const {live,scope}=authority(),listeners=new Set(),timers=new Map();let id=0,recovered=0,operation='first';
  const events={addEventListener(_name,fn){listeners.add(fn)},removeEventListener(_name,fn){listeners.delete(fn)}};
  const clock={setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(key){timers.delete(key)}};
  for(let cycle=0;cycle<100;cycle++){
    const lifetime=createMorningLifetime({operationScope:scope,getPendingOperationId:()=>operation,recover:async()=>{recovered++},onInterrupt(){},events,timers:clock});
    const receipt=lifetime.capture();assert.equal(lifetime.scheduleRecovery(1,receipt),true);assert.equal(lifetime.scheduleRecovery(1,receipt),false);
    const stale=timers.values().next().value;live.account.epoch++;assert.equal(lifetime.scheduleRecovery(1,lifetime.capture()),true);assert.equal(timers.size,1);
    stale();assert.equal(recovered,0);lifetime.dispose();lifetime.dispose();for(const fn of timers.values())fn();assert.equal(recovered,0);
    assert.equal(listeners.size,0);assert.equal(timers.size,0);assert.throws(receipt,changed);
  }
});
