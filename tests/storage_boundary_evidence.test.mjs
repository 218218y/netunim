import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStorageV2Boundary} from '../shared/storage-v2-boundary.js';
import {readStorageBoundary} from '../shared/storage-operation.js';
import {applyStorageV2RestoreGroup,captureStorageV2RestoreSource} from '../shared/storage-v2-restore.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';

const clone=structuredClone;
const record=()=>({version:2,owner:'A',id:'restore-1',kind:'restore',phase:'prepared',main:{kind:'replace-authoritative',state:{notes:[]}},shared:{kind:'replace-authoritative',state:{checks:[],bankEvents:[]}}});
function fixture(value,{advance}={}) {
  let stored=clone(value),applied=0;
  const runtime={recover:async()=>({state:{},seq:0}),replaceAuthoritativeState:async()=>{applied++;return {seq:0}}};
  const db={readBoundary:async()=>clone(stored),advanceBoundary:async(_owner,_id,_from,phase)=>{stored=advance?advance(stored,phase):{...stored,phase};return clone(stored)},completeBoundary:async()=>{stored={version:2,owner:'A',id:stored.id,kind:stored.kind,phase:'complete'}}};
  const owner=createStorageV2Boundary({owner:()=> 'A',primary:()=>true,main:runtime,shared:runtime,db});
  return {owner,applied:()=>applied,stored:()=>clone(stored)};
}
for(const phase of ['future','',null,4,{},[]])test(`unknown durable phase ${JSON.stringify(phase)} cannot unlock or apply`,async()=>{
  const input={...record(),phase},f=fixture(input);
  await assert.rejects(f.owner.resume(),/phase_invalid/);assert.equal(f.owner.locked,true);assert.equal(f.applied(),0);assert.deepEqual(f.stored(),input);
  await assert.rejects(f.owner.pending(),/phase_invalid/);assert.equal(f.owner.locked,true);
});
for(const change of [r=>{r.owner='B'},r=>{r.id=5},r=>{r.main.state='not-state'},r=>{r.shared.options=[]},r=>{r.main.options={appMetadata:{boundaryId:'foreign'}}}])test('malformed persisted authority is retained before journal replacement',async()=>{
  const input=record();change(input);const f=fixture(input);
  await assert.rejects(f.owner.resume());assert.equal(f.owner.locked,true);assert.equal(f.applied(),0);assert.deepEqual(f.stored(),input);
});
for(const change of [(r,phase)=>({...r,phase,id:'other'}),(r,phase)=>({...r,phase,main:{...r.main,state:{notes:[{id:'foreign'}]}}}),(r)=>({...r,phase:'complete'})])test('phase writes cannot substitute operation identity, content or completion',async()=>{
  const f=fixture(record(),{advance:change});await assert.rejects(f.owner.resume(),/transition_changed/);assert.equal(f.applied(),1);assert.equal(f.owner.locked,true);
});
test('compact completed markers still require matching owner, id, kind and version',()=>{
  assert.equal(readStorageBoundary({version:2,owner:'A',id:'done',kind:'restore',phase:'complete'},'A').phase,'complete');
  assert.throws(()=>readStorageBoundary({version:2,owner:'B',id:'done',kind:'restore',phase:'complete'},'A'));
});
const clean=(seq,revision)=>({seq,base:{revision,ackSeq:seq},pending:false,flight:null,control:null});
const restore=()=>({group:{restoreGroupId:'restore-1',v2Source:captureStorageV2RestoreSource(clean(2,8),clean(3,10)),main:{state:{notes:[]}},checks:{}},target:{notes:[]},sharedState:{checks:[],bankEvents:[]}});
for(const revision of [true,false,[],[9],{},'', ' ', '09', '9.0',-1,Infinity,Number.MAX_SAFE_INTEGER+1])test(`restore rejects ambiguous revision ${JSON.stringify(revision)} before boundary`,async()=>{
  let calls=0;await assert.rejects(applyStorageV2RestoreGroup({...restore(),result:{main_revision:revision,checks_revision:11},boundary:{run:async()=>{calls++}}}));assert.equal(calls,0);
});
test('canonical integer strings remain readable but regressed or failed receipts have no authority',async()=>{
  const f=restore(),calls=[];await applyStorageV2RestoreGroup({...f,result:{main_revision:'9',checks_revision:'11'},boundary:{run:async intent=>calls.push(intent)}});assert.equal(calls[0].main.revision,9);
  for(const result of [{main_revision:7,checks_revision:11},{ok:false,main_revision:9,checks_revision:11}])await assert.rejects(applyStorageV2RestoreGroup({...f,result,boundary:{run:async()=>assert.fail('invalid receipt published')}}));
});
test('restore capture and local import require matching durable ACK sequences',async()=>{
  const malformed={...clean(2,8),base:{revision:8,ackSeq:1}};assert.throws(()=>captureStorageV2RestoreSource(malformed,clean(3,10)));
  await assert.rejects(applyStorageV2LocalImport({boundary:{run:async()=>assert.fail()},mainCloud:malformed,sharedCloud:clean(3,10),mainState:{},sharedState:{}}));
  await assert.rejects(applyStorageV2LocalImport({boundary:{run:async()=>assert.fail()},mode:'local-only',mainCloud:{flight:{id:'F'}},mainLocal:{seq:0},sharedLocal:{seq:0},mainState:{},sharedState:{}}));
});
test('negative consumer mutation reproduces the former silent unlock for unknown phases',async()=>{
  let source=fs.readFileSync('shared/storage-v2-boundary.js','utf8');
  for(const name of ['storage-journal-idb.js','storage-operation.js','cloud-sync.js'])source=source.replace(`'./${name}'`,JSON.stringify(new URL('../shared/'+name,import.meta.url).href));
  const expression='const decoded=readStorageBoundary(record,scoped);';assert.equal(source.split(expression).length,3);
  // The second use is the persisted-read consumer. Its omission restores the gap.
  const at=source.lastIndexOf(expression);source=source.slice(0,at)+source.slice(at).replace(expression,'const decoded=record;');
  const {createStorageV2Boundary:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const owner=unsafe({owner:()=> 'A',primary:()=>true,main:{},shared:{},db:{readBoundary:async()=>({...record(),phase:'future'})}});
  assert.equal((await owner.resume()).phase,'future');assert.equal(owner.locked,false,'negative implementation must expose the silent unlock');
});
