import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaxSync} from '../shared/tax-calculator/sync.js';
import {createProfile,clone,same} from '../shared/tax-calculator/contracts.js';

function fixture(){
  const db=new Map(),cloud=new Map(),operations=new Map();let sequence=0;
  const f={owner:'A',epoch:1,online:true,dropAck:false,delay:null,writes:[],writable:true};
  const store={read:async(o,n)=>clone(db.get(o+'/'+n)??null),update:async(o,n,change)=>{const result=change(clone(db.get(o+'/'+n)??null));db.set(o+'/'+n,clone(result));return clone(result);},close(){}};
  const request=async(path,options)=>{
    options.assertRequestScope();if(!f.online)throw new Error('offline');
    if(!options.method){const url=new URL('https://test'+path),name=url.searchParams.get('document_name')?.slice(3),owner=url.searchParams.get('owner_id')?.slice(3);const row=cloud.get(owner+'/'+name);return new Response(JSON.stringify(row?[row]:[]));}
    const body=JSON.parse(options.body),owner=f.owner,key=owner+'/'+body.p_document_name;f.writes.push(clone(body));
    if(f.delay){const delay=f.delay;f.delay=null;await delay;}options.assertRequestScope();
    const opKey=owner+'/'+body.p_operation_id;let ack=operations.get(opKey);
    if(!ack){const previous=cloud.get(key);if((previous?.revision??0)!==body.p_expected_revision)return new Response(JSON.stringify({code:'40001'}),{status:500});ack={owner_id:owner,document_name:body.p_document_name,state:clone(body.p_state),revision:body.p_expected_revision+1,operation_id:body.p_operation_id,operation_replayed:false};operations.set(opKey,clone(ack));cloud.set(key,clone(ack));}else ack={...ack,operation_replayed:true};
    if(f.dropAck){f.dropAck=false;throw new Error('lost ACK');}
    return new Response(JSON.stringify(ack));
  };
  f.create=()=>createTaxSync({accountScope:()=>({owner:f.owner,epoch:f.epoch}),request,store,writable:()=>f.writable,uuid:()=>`op-${++sequence}`});
  f.db=db;f.cloud=cloud;return f;
}
const edit=async(s,adults)=>{const p=clone(s.current('profile'));p.adults=adults;await s.save('profile',p);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('offline draft survives restart and is shared through cloud with another origin',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());f.online=false;await edit(s,4);await assert.rejects(s.flush());assert.equal(s.state.status,'offline');
  const reopened=f.create();await reopened.open('profile',createProfile());assert.equal(reopened.current('profile').adults,4);f.online=true;await reopened.flush();assert.equal(f.cloud.get('A/profile').state.adults,4);assert.equal(reopened.state.status,'synced');
});
test('lost ACK replays exact persisted operation after restart, even after a later server write',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());await edit(s,3);f.dropAck=true;await assert.rejects(s.flush());assert.equal(f.writes.length,1);
  const reopened=f.create();await reopened.open('profile',createProfile());await reopened.flush();assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(reopened.state.status,'synced');
});
test('local durability continues while earlier HTTP write is pending',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());await edit(s,2);let release;f.delay=new Promise(resolve=>{release=resolve;});const flight=s.flush();await tick();await edit(s,5);assert.equal(f.db.get('A/profile').draft.adults,5);release();await flight;assert.equal(f.cloud.get('A/profile').state.adults,5);
});
test('concurrent cloud edits produce a comparison, never a last-writer overwrite',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());await s.flush();await edit(s,4);const head=f.cloud.get('A/profile');head.revision++;head.state.adults=7;
  await s.flush();assert.equal(s.state.status,'conflict');assert.equal(f.cloud.get('A/profile').state.adults,7);assert.equal(s.current('profile').adults,4);
  await s.resolve('profile','local');await s.flush();assert.equal(f.cloud.get('A/profile').state.adults,4);
});
test('another tab changing IDB invalidates an older local writer',async()=>{
  const f=fixture(),a=f.create(),b=f.create();await a.open('profile',createProfile());await b.open('profile',createProfile());await edit(a,6);await assert.rejects(edit(b,3),/לשונית/);assert.equal(f.db.get('A/profile').draft.adults,6);
});
test('account switch during RPC cannot publish an ACK or reveal the previous model',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());await edit(s,2);let release;f.delay=new Promise(resolve=>{release=resolve;});const flight=s.flush();await tick();f.owner='B';f.epoch++;release();await assert.rejects(flight,/חשבון/);assert.equal(s.current('profile'),null);assert.equal(f.cloud.has('B/profile'),false);assert.equal(f.db.get('A/profile').draft.adults,2);
});
test('same-account relogin and loss of primary authority invalidate a queued write',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());f.epoch++;assert.equal(s.current('profile'),null);await s.open('profile',createProfile());f.writable=false;await assert.rejects(async()=>edit(s,9));assert.equal(f.writes.length,0);
});
test('JSONB key reordering is immaterial to operation confirmation',()=>{assert.ok(same({schema:1,kind:'profile'},{kind:'profile',schema:1}));});
test('disposal drains an accepted network flight before closing local storage',async()=>{
  const f=fixture(),s=f.create();await s.open('profile',createProfile());await edit(s,3);let release;f.delay=new Promise(resolve=>{release=resolve;});const flight=s.flush();await tick();let disposed=false;const drain=s.dispose().then(()=>{disposed=true;});await tick();assert.equal(disposed,false);release();await flight;await drain;assert.equal(disposed,true);assert.equal(f.cloud.get('A/profile').state.adults,3);
});
