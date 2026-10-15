import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupBrowserResources} from '../shared/backup-browser-resources.js';
import {createBackupFileAuthority} from '../shared/backup-file-authority.js';
import {createBackupBrowserResources as orders} from '../netunim-orders/site/assets/js/shared/backup-browser-resources.js';
import {createBackupBrowserResources as kupa} from '../netunim-kupa/site/assets/js/shared/backup-browser-resources.js';

function gate(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function fixture(create=createBackupBrowserResources){
  const nodes=new Set(),jobs=new Map(),urls=new Set(),revoked=[],events=[],created=[];let id=0,owner='local',generation=1,account={owner:null,epoch:0},writable=true,clickFailure=false;
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.files=[];this.listeners=0;created.push(this)}
    addEventListener(...args){this.listeners++;super.addEventListener(...args)}
    removeEventListener(...args){this.listeners--;super.removeEventListener(...args)}
    remove(){nodes.delete(this)}
    click(){if(clickFailure)throw Error('native click failed');events.push(this.tag)}
  }
  const authority=createBackupFileAuthority({owner:()=>owner,generation:()=>generation,account:()=>account,writable:()=>writable});
  const api=create({authority,platform:{
    document:()=>({createElement:tag=>new Element(tag),body:{appendChild:node=>nodes.add(node)}}),
    urls:{create:()=>{const url='blob:backup-'+(++id);urls.add(url);return url},revoke:url=>{assert.equal(urls.delete(url),true);revoked.push(url)}},
    timers:{setTimeout:run=>{const timer=++id;jobs.set(timer,run);return timer},clearTimeout:timer=>jobs.delete(timer)},
  }});
  return {api,nodes,jobs,urls,revoked,created,events,get input(){return created.findLast(node=>node.tag==='input')},
    change(kind){if(kind==='owner')owner='replacement';if(kind==='generation')generation++;if(kind==='login')account={owner:null,epoch:account.epoch+1};if(kind==='primary')writable=false},
    failClick:()=>{clickFailure=true},file:text=>({name:'backup.json',size:2,text:async()=>text}),
  };
}

for(const [name,create] of [['canonical',createBackupBrowserResources],['orders',orders],['kupa',kupa]]){
  for(const transition of ['owner','generation','login','primary'])test(`${name} file read captures ${transition} before awaiting bytes`,async()=>{
    const f=fixture(create),held=gate();let parsed=0;
    const reading=f.api.read({...f.file('{}'),text:()=>held.promise},()=>{parsed++;return true});
    f.change(transition);held.resolve('{}');
    await assert.rejects(reading,error=>error.code==='backup_file_scope_changed');assert.equal(parsed,0);
  });
  test(`${name} disposal cancels open input and drains accepted file bytes without late publication`,async()=>{
    const f=fixture(create),held=gate();let parsed=0;
    const selecting=f.api.choose(()=>{parsed++;return true});
    f.input.files=[{...f.file('{}'),text:()=>held.promise}];f.input.dispatchEvent(new Event('change'));
    assert.equal(f.api.runtime.dispose(),true);assert.equal(f.api.runtime.dispose(),false);assert.equal(await selecting,null);
    let drained=false;const drain=f.api.runtime.drain().then(()=>drained=true);await tick();assert.equal(drained,false);
    assert.equal(f.nodes.size,0);assert.equal(f.input.listeners,0);
    held.resolve('{}');await drain;assert.equal(parsed,0);assert.equal(f.api.runtime.isPending(),false);
    assert.equal(await f.api.choose(()=>true),null);
  });
}
test('native cancellation resolves and removes input listeners without reading or parsing',async()=>{
  const f=fixture(),pending=f.api.choose(()=>assert.fail('cancelled parsing'));
  f.input.dispatchEvent(new Event('cancel'));assert.equal(await pending,null);await f.api.runtime.drain();
  assert.equal(f.nodes.size,0);assert.equal(f.input.listeners,0);
});
test('native selection/click errors and file size errors release every input',async()=>{
  const f=fixture();f.failClick();await assert.rejects(f.api.choose(()=>true),/native click failed/);assert.equal(f.nodes.size,0);assert.equal(f.input.listeners,0);
  const g=fixture(),pending=g.api.choose(()=>assert.fail('oversized parsing'),1);
  g.input.files=[g.file('{}')];g.input.dispatchEvent(new Event('change'));await assert.rejects(pending,/גדול מדי/);assert.equal(g.nodes.size,0);
});
test('an accepted restore can advance its own generation while its cleanup remains drained',async()=>{
  const f=fixture(),held=gate(),entered=gate(),scope=f.api.capture();
  const restoring=f.api.run(scope,async()=>{entered.resolve();await held.promise;scope.assertCurrent();f.change('generation');return true});
  await entered.promise;let drained=false;const drain=f.api.runtime.drain().then(()=>drained=true);await tick();assert.equal(drained,false);
  held.resolve();assert.equal(await restoring,true);await drain;
});
test('a completed file picker leaves its accepted preview proof valid for the later restore',async()=>{
  const f=fixture(),choosing=f.api.choose((raw,_file,scope)=>({raw,scope}));
  f.input.files=[f.file('{}')];f.input.dispatchEvent(new Event('change'));
  const preview=await choosing;assert.equal(f.input.listeners,0);assert.equal(f.nodes.size,0);
  assert.equal(preview.scope.assertCurrent(),true);
  assert.equal(await f.api.run(preview.scope,()=>{f.change('generation');return true}),true);
});
test('invalidating an accepted confirmation aborts its signal and waits for consumer cleanup',async()=>{
  const f=fixture(),held=gate(),scope=f.api.capture();let published=0;
  const restoring=f.api.run(scope,async()=>{await held.promise;scope.assertCurrent();published++;return true});
  f.api.runtime.invalidate();assert.equal(scope.signal.aborted,true);
  let drained=false;const drain=f.api.runtime.drain().then(()=>drained=true);await tick();assert.equal(drained,false);
  held.resolve();assert.equal(await restoring,null);await drain;assert.equal(published,0);
  assert.equal(await f.api.read(f.file('{}'),()=>true),true,'invalidating one account must not dispose the next lifetime');
});
test('download ownership revokes the captured URL and cancels its timer on invalidation',()=>{
  const f=fixture();assert.equal(f.api.download(new Blob(['saved']),'backup.json'),true);
  const anchor=f.created.findLast(node=>node.tag==='a'),href=anchor.href;
  anchor.href='blob:changed-outside-owner';assert.equal(f.jobs.size,1);
  f.api.runtime.invalidate();assert.deepEqual(f.revoked,[href]);assert.equal(f.jobs.size,0);assert.equal(f.nodes.size,0);
});
test('download click failure immediately revokes URL; repeated lifetimes retain no resources',()=>{
  const f=fixture();f.failClick();assert.throws(()=>f.api.download(new Blob(['x']),'backup.json'),/native click failed/);
  assert.equal(f.urls.size,0);assert.equal(f.nodes.size,0);
  const g=fixture();for(let i=0;i<100;i++){g.api.download(new Blob(['x']),'backup.json');g.api.runtime.invalidate();assert.equal(g.urls.size,0);assert.equal(g.jobs.size,0);assert.equal(g.nodes.size,0)}
});
test('obsolete file read errors cannot publish former-account diagnostics',async()=>{
  const f=fixture(),held=gate();const read=f.api.read({...f.file('{}'),text:()=>held.promise},()=>true);
  f.change('login');held.reject(Error('private old file error'));await assert.rejects(read,error=>error.code==='backup_file_scope_changed');
});
test('file authority captures primitive login evidence even when its provider reuses an object',()=>{
  const account={owner:'A',epoch:1},authority=createBackupFileAuthority({owner:()=> 'A',generation:()=>1,account:()=>account,writable:()=>true});
  const scope=authority.capture('restore');account.epoch++;
  assert.throws(scope.assertCurrent,error=>error.code==='backup_file_scope_changed');
});
