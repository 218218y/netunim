import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStoragePersistence} from './orders_persistence_ports.mjs';

function gate() { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject}; }
async function settle() { for(let i=0;i<30;i++) await Promise.resolve(); }
function fixture(t,{localOk=false,folder=false,folderFailure=false,folderWork=async()=>{}}={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(console,'error',()=>{});
  const pending=gate(),session={localGeneration:0},events=[];
  let receipt=pending.promise;
  const owner=createStoragePersistence({session,tab:{primaryTab:true},localSnapshot:()=>localOk,
    storageV2CommitPromise:()=>receipt,storageV2DurabilityAtRisk:()=>true,
    domainRevisions:{touch:()=>{},touchAll:()=>{}},showSecondaryTabGuard:()=>events.push('guard'),
    setSave:(text,mode)=>events.push(['save',text,mode]),setCloud:(text,mode)=>events.push(['cloud',text,mode]),
    cloudEnabled:()=>true,requestCloudSave:async()=>events.push('cloud'),
    folderBackupAvailable:()=>folder,folderSaveTitle:()=>'',syncFolderAccessButton:()=>{},
    writeStateToFolder:async()=>{events.push('folder');if(folderFailure)throw Error('folder unavailable');await folderWork();return true},platform:{isOnline:()=>false,reload:()=>events.push('reload')},
  });
  return {owner,pending,session,events,setReceipt:value=>{receipt=value}};
}
for(const result of [false,undefined]) test(`unconfirmed receipt ${result} cannot publish or clear IDB risk`,async t=>{
  const f=fixture(t);f.owner.scheduleSave('edit');f.pending.resolve(result);
  t.mock.timers.tick(200);await f.owner.runtime.drain();
  assert.equal(f.events.includes('cloud'),false);assert.equal(f.session.localUndurableGenerations.has(1),true);
});
test('cancelled publication still drains its accepted local commit and retains offline intent',async t=>{
  const f=fixture(t);f.owner.scheduleSave('edit');f.owner.runtime.cancelPending();
  let drained=false;const work=f.owner.runtime.drain().then(()=>{drained=true});await settle();assert.equal(drained,false);
  assert.ok(f.events.some(row=>row[0]==='cloud'&&row[2]==='offline'));
  f.pending.resolve(true);await work;assert.equal(f.session.localUndurableGenerations.size,0);assert.equal(f.events.includes('cloud'),false);
});
test('a failed captured IDB receipt cannot overwrite a folder with a draft despite a newer success',async t=>{
  const f=fixture(t,{folder:true});f.owner.scheduleSave('first');
  f.setReceipt(Promise.resolve(true));f.pending.reject(Error('first commit aborted'));
  t.mock.timers.tick(200);await f.owner.runtime.drain();assert.equal(f.events.includes('folder'),false);assert.equal(f.events.includes('cloud'),false);
});

for(const result of [false,undefined])test(`unconfirmed receipt ${result} preserves an available folder`,async t=>{
  const f=fixture(t,{folder:true});f.owner.scheduleSave('draft');f.pending.resolve(result);
  t.mock.timers.tick(200);await f.owner.runtime.drain();
  assert.equal(f.events.includes('folder'),false);assert.equal(f.events.includes('cloud'),false);
});

test('an earlier durable receipt cannot capture a later pending or failed visible generation',async t=>{
  const f=fixture(t,{folder:true}),next=gate();
  f.owner.scheduleSave('first');t.mock.timers.tick(200);await settle();
  f.setReceipt(next.promise);f.owner.scheduleSave('newer draft');f.pending.resolve(true);await settle();
  assert.equal(f.events.includes('folder'),false,'old receipt cannot copy the new visible draft');
  next.reject(Error('newer IDB abort'));t.mock.timers.tick(200);await f.owner.runtime.drain();
  assert.equal(f.events.includes('folder'),false);assert.ok(f.session.localUndurableGenerations.has('failed:2'));
});
test('folder failure leaves a durable local commit eligible for cloud publication',async t=>{
  const f=fixture(t,{localOk:true,folder:true,folderFailure:true});f.owner.scheduleSave('edit');f.pending.resolve(true);
  t.mock.timers.tick(200);await f.owner.runtime.drain();assert.equal(f.events.includes('cloud'),true);
});

test('a hanging optional folder copy cannot hold the durable cloud publication',async t=>{
  const backup=gate(),f=fixture(t,{folder:true,folderWork:()=>backup.promise});
  f.owner.scheduleSave('edit');f.pending.resolve(true);t.mock.timers.tick(200);await settle();
  try{assert.equal(f.events.includes('folder'),true);assert.equal(f.events.includes('cloud'),true)}
  finally{backup.resolve();await f.owner.runtime.drain()}
});
test('disposal joins local completion without repainting a closed owner',async t=>{
  const f=fixture(t);f.owner.scheduleSave('edit');assert.equal(f.owner.runtime.dispose(),true);
  const count=f.events.length;f.pending.reject(Error('closed commit failed'));await f.owner.runtime.drain();
  assert.equal(f.events.length,count);assert.equal(f.owner.scheduleSave('late'),false);
});
test('publication implementation mutation exposes a false receipt as cloud authority',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const source=fs.readFileSync('netunim-orders/site/assets/js/storage/save-publication.js','utf8');
  const expression="if (await committed!==true) throw new Error('storage_local_commit_unconfirmed');";
  assert.equal(source.split(expression).length,2);
  const mutated=source.replace(/'\.\.\/shared\/([^']+)'/g,(_match,name)=>JSON.stringify(new URL('../shared/'+name,import.meta.url).href)).replace(expression,'await committed;');
  const {createOrdersSavePublication}=await import('data:text/javascript;base64,'+Buffer.from(mutated).toString('base64'));
  let sent=0;const owner=createOrdersSavePublication({session:{localGeneration:1},journal:{storageV2CommitPromise:async()=>true},mirror:{available:()=>false,refreshAccess:()=>{}},cloud:{enabled:()=>true,save:async()=>{sent++}},view:{setSave:()=>{},setCloud:()=>{},folderSaveTitle:()=>''},platform:{isOnline:()=>true}});
  owner.schedule({generation:1,localOk:false,accepted:true,committed:Promise.resolve(false)},'unsafe');
  t.mock.timers.tick(200);await owner.drain();assert.equal(sent,1,'negative implementation must expose the removed evidence gate');
});
