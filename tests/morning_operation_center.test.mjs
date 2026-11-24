import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningOperationCenter} from '../shared/morning-operation-center.js';

const id='00000000-0000-4000-8000-000000000031';
const pending={operation_id:id,stage:'check_registration',document_number:'3972',document_type:320,
  amount:9300,check_amount:9300,check_count:10,attempts:64,error_code:'mfa_required',resolved_at:null};
const reply=(body,status=200)=>Response.json(body,{status});

test('empty, first-read failures and auth failure have distinct cloud evidence',async()=>{
  let mode='fail',now=1;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},now:()=>now,
    request:async()=>mode==='fail'?reply({},500):mode==='auth'?reply({},401):reply({ok:true,operations:[]})});
  await center.refresh();assert.equal(center.availability,'unavailable');assert.ok(center.cloudStatusLabel);
  mode='empty';await center.refresh({force:true});assert.equal(center.availability,'fresh');assert.equal(center.cloudStatusLabel,'');
  mode='fail';now+=46000;await center.refresh();assert.equal(center.availability,'stale');assert.ok(center.cloudStatusLabel);assert.equal(center.count,0);
  mode='auth';await center.refresh({force:true});assert.equal(center.availability,'auth');assert.match(center.cloudStatusLabel,/אימות/);
});

test('a 51st operation is reachable and registered checks are not presented as pending bank work',async()=>{
  const first=Array.from({length:50},(_,i)=>({...pending,operation_id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`}));
  const cursor={priority:0,sort_at:'2026-11-24T15:00:00Z',operation_id:first.at(-1).operation_id};
  const last={...pending,stage:'bank_link',source_kind:'bank',document_number:'LAST-51',checks_registered_at:'2026-11-24T15:00:00Z'};
  const request=async(_path,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='status')return reply({ok:true,operation:{operation_id:id,state:'created'},bank_link_pending:true});
    if(body.after){assert.deepEqual(body.after,cursor);return reply({ok:true,operations:[last],next:null})}
    return reply({ok:true,operations:first,next:cursor});
  };
  const center=createMorningOperationCenter({request,accountScope:()=>({owner:'owner',epoch:1}),publish(){}});
  await center.refresh();assert.equal(center.count,50);assert.equal(center.more,true);
  await center.action('morning-next','');
  assert.match(center.markup(String),/LAST-51/);assert.match(center.markup(String),/10 נרשמו/);
  assert.doesNotMatch(center.markup(String),/10 ממתינים/);
  await center.action('morning-retry',id);
  assert.match(center.markup(String),/קישור המסמך לתנועת הבנק עדיין ממתין/);
  await center.action('morning-previous','');assert.doesNotMatch(center.markup(String),/LAST-51/);
});

test('known retry failures and cooldown are shown without recording completion',async()=>{
  let state='failed';
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(path,options)=>JSON.parse(options.body).action==='list_recovery'
      ?reply({ok:true,operations:[pending],next:null})
      :reply({ok:true,operation:{operation_id:id,state:'created'},checks_registration_pending:true,
        check_retry:{state,retry_at:'2026-11-24T15:00:00Z'}})});
  await center.refresh();await center.action('morning-retry',id);
  assert.match(center.markup(String),/ניסיון ההתאוששות נכשל/);
  state='cooldown';await center.action('morning-retry',id);
  assert.match(center.markup(String),/הניסיון מוגבל עד/);
  assert.equal(center.count,1);
});

test('two devices share the server outcome while acknowledging independently',async()=>{
  let rows=[pending],calls=[],time=0,offline=false;
  const request=async(path,options)=>{
    assert.equal(path,'/functions/v1/morning-documents');
    const body=JSON.parse(options.body);calls.push(body);
    if(offline)throw new Error('offline');
    if(body.action==='list_recovery')return reply({ok:true,operations:rows});
    assert.deepEqual(body,{action:'status',operation_id:id,reconcile:true,retry_checks:true});
    rows=[{...pending,stage:'registered',resolved_at:'2026-11-24T15:00:00Z',error_code:null}];
    return reply({ok:true,operation:{operation_id:id}});
  };
  const ports={request,accountScope:()=>({owner:'same-owner',epoch:1}),publish(){},now:()=>time};
  const orders=createMorningOperationCenter(ports),kupa=createMorningOperationCenter(ports);
  await Promise.all([orders.refresh(),orders.refresh(),kupa.refresh()]);
  assert.equal(calls.length,2);
  assert.equal(orders.count,1);assert.equal(kupa.count,1);
  assert.match(orders.markup(String),/3972/);
  await orders.action('morning-ack',id);
  assert.equal(orders.count,1);assert.equal(orders.unread,0);assert.equal(kupa.unread,1);
  assert.match(orders.markup(String),/3972/);
  await Promise.all([orders.action('morning-retry',id),orders.action('morning-retry',id)]);
  assert.equal(calls.filter(call=>call.action==='status').length,1);
  assert.equal(orders.count,0);assert.equal(kupa.count,1);
  offline=true;time+=46_000;await kupa.refresh();
  assert.equal(kupa.count,1,'loss of connection does not hide known incidents');
  assert.match(kupa.markup(String),/אינו מעודכן/);
  offline=false;await kupa.refresh({force:true});
  assert.equal(kupa.count,0);assert.equal(kupa.unread,0);
  assert.match(kupa.markup(String),/רישומי צ׳קים שהושלמו לאחרונה/);
});

test('the response from a previous account cannot repopulate the center',async()=>{
  let scope={owner:'first',epoch:1},release;
  const center=createMorningOperationCenter({accountScope:()=>scope,publish(){},request:()=>
    scope.owner==='first'?new Promise(resolve=>{release=resolve}):Promise.resolve(reply({ok:true,operations:[]}))});
  const read=center.refresh();
  scope={owner:'second',epoch:2};
  await center.refresh();
  release(reply({ok:true,operations:[pending]}));await read;
  assert.equal(center.count,0);assert.doesNotMatch(center.markup(String),/3972/);
});
