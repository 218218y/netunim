import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningOperationCenter} from '../shared/morning-operation-center.js';

const id='00000000-0000-4000-8000-000000000031';
const pending={operation_id:id,stage:'check_registration',document_number:'3972',document_type:320,
  amount:9300,check_amount:9300,check_count:10,attempts:64,error_code:'mfa_required',resolved_at:null};
const reply=(body,status=200)=>Response.json(body,{status});

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
