import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createRestoreGroup,createRestoreGroupStore} from '../shared/restore-groups.js';
import {readRestoreGroupRows} from '../shared/restore-response-records.js';
import {resumeServerRestoreGroups} from '../shared/restore-server-recovery.js';

const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',at='2026-10-16T10:00:00Z';
const group={restore_group_id:id,app_site:'orders',phase:'staged',created_at:at,updated_at:at};
const receipt={restore_group_id:id,phase:'completed',main_revision:9,checks_revision:12};
const response=body=>({ok:true,json:async()=>body,text:async()=>JSON.stringify(body)});
const invalid={code:'RESTORE_RESPONSE_EVIDENCE_INVALID'};
for(const [app,create] of [['orders',orders],['kupa',kupa]]){
  const transport=body=>create({session:{cloudDocumentName:'main'},supaFetch:async()=>response(body),supaRest:async()=>response(body)});
  test(`${app} malformed recovery lists cannot mean no restores`,async()=>{
    for(const body of [null,{},[null],[{}],[group,group],[{...group,restore_group_id:'bad'}],
      [{...group,phase:['staged']}],[{...group,app_site:['orders']}],
      [{...group,phase:'completed'}],[{...group,app_site:'other'}],[{...group,updated_at:'2026-02-30T10:00:00Z'}]]){
      await assert.rejects(transport(body).listIncompleteRestoreGroups(),invalid);
    }
    assert.deepEqual(await transport([]).listIncompleteRestoreGroups(),[]);
    assert.deepEqual(await transport([group]).listIncompleteRestoreGroups(),[group]);
  });
  test(`${app} restore receipts require exact identity, phase and revisions`,async()=>{
    const plan=await createRestoreGroup({appSite:app,restoreGroupId:id,main:{state:{notes:[]},baseRevision:8}});
    for(const body of [null,{},[],[{}],[{restore_group_id:other,phase:'staged'}],[{restore_group_id:id,phase:'unknown'}]]){
      await assert.rejects(transport(body).stageRestoreGroup(plan),invalid);
    }
    await transport([{restore_group_id:id,phase:'staged'}]).stageRestoreGroup(plan);
    for(const body of [null,{},[],[receipt,receipt],[{...receipt,restore_group_id:other}],
      [{...receipt,phase:'main_acked'}],[{...receipt,main_revision:'9'}],[{...receipt,checks_revision:undefined}]]){
      await assert.rejects(transport(body).applyRestoreGroup(id),invalid);
    }
    assert.deepEqual(await transport([receipt]).applyRestoreGroup(id),receipt);
    assert.equal((await transport([{...receipt,checks_revision:null}]).applyRestoreGroup(id)).checks_revision,null);
  });
}

function fixture(){
  const values=new Map(),storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const makeStore=()=>createRestoreGroupStore({localKey:'test.restore',storage,
    put:async(key,value)=>values.set(key,structuredClone(value)),get:async key=>structuredClone(values.get(key)??null),remove:async key=>values.delete(key)});
  const events=[],source={mainSeq:0,mainRevision:8,sharedSeq:0,sharedRevision:11};
  const heads={main:{document_name:'main',revision:9,updated_at:at,state:{notes:[{id:'restored'}]}},
    shared:{document_name:'main',revision:12,updated_at:at,state:{checks:[{id:'C'}],bankEvents:[]}}};
  const ports={appSite:'orders',owner:'A',store:makeStore(),listRemote:async()=>[group],readSource:async()=>source,
    applyRemote:async requested=>{events.push('server:'+requested);return receipt},readHeads:async()=>heads,
    applyLocally:async(plan,result)=>events.push({plan,result}),assertCurrent:()=>{}};
  return {ports,values,makeStore,events,heads};
}

test('server-only restore reads and adopts both authoritative heads before completion',async()=>{
  const f=fixture();assert.equal(await f.ports.store.loadPending(),null);
  assert.equal(await resumeServerRestoreGroups(f.ports),true);
  const applied=f.events[1];assert.equal(applied.plan.restoreGroupId,id);
  assert.deepEqual(applied.plan.main.state,f.heads.main.state);assert.deepEqual(applied.plan.checks.state,f.heads.shared.state);
  assert.equal(applied.result.main_revision,9);assert.equal(applied.result.checks_revision,12);
  assert.equal(await f.ports.store.loadServerPending('A'),null);
});

for(const failure of ['read','adopt','stale-head'])test(`server-only ${failure} failure survives restart after server completion`,async()=>{
  const f=fixture();
  if(failure==='read')f.ports.readHeads=async()=>{throw Error('network')};
  if(failure==='adopt')f.ports.applyLocally=async()=>{throw Error('IDB aborted')};
  if(failure==='stale-head')f.ports.readHeads=async()=>({...f.heads,main:{...f.heads.main,revision:8}});
  await assert.rejects(resumeServerRestoreGroups(f.ports));
  assert.equal((await f.ports.store.loadServerPending('A')).restore_group_id,id);
  assert.equal(await f.ports.store.loadServerPending('B'),null);
  const next=fixture();next.ports.store=f.makeStore();next.ports.listRemote=async()=>[];
  assert.equal(await resumeServerRestoreGroups(next.ports),true,'completed server group is retried from durable local identity');
  assert.equal(next.events[0],'server:'+id);assert.equal(await next.ports.store.loadServerPending('A'),null);
});

test('malformed list and stale account cannot apply a server group',async()=>{
  const f=fixture();f.ports.listRemote=async()=>({});
  await assert.rejects(resumeServerRestoreGroups(f.ports),invalid);assert.deepEqual(f.events,[]);
  f.ports.listRemote=async()=>{f.ports.assertCurrent=()=>{throw Error('scope changed')};return [group]};
  // The captured guard must itself observe account changes, as production does.
  let current=true;f.ports.assertCurrent=()=>{if(!current)throw Error('scope changed')};
  f.ports.listRemote=async()=>{current=false;return [group]};
  await assert.rejects(resumeServerRestoreGroups(f.ports),/scope changed/);assert.deepEqual(f.events,[]);
  assert.throws(()=>readRestoreGroupRows([{...group,phase:'checks_acked',updated_at:'2020-01-01T00:00:00Z'}]),invalid);
});

test('Kupa restore reads exact Main state without overlaying independent Finance data',async()=>{
  const state={cash:[],rights:[],notes:[],credits:[],expenses:[],cards:[],bank:{currentBalance:100},creditSync:{profiles:[]}};
  const paths=[],api=kupa({session:{cloudDocumentName:'main'},supaRest:async path=>{
    paths.push(path);assert.ok(path.includes('/kupa_documents?'));
    return response([{document_name:'main',revision:9,updated_at:at,state}]);
  }});
  const head=await api.readSupabaseDocument({includeFinance:false});
  assert.deepEqual(head.state,state);assert.equal(paths.length,1);
});
