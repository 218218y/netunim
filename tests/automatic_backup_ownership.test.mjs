import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageBackup as kupaBackup} from '../netunim-kupa/site/assets/js/storage/backup.js';
import {createStorageBackup as ordersBackup} from '../netunim-orders/site/assets/js/storage/backup.js';

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const snapshot=content=>({version:4,notes:[{id:'retained-note',content}]});
function directory(){
  const entries=new Map(),removed=[];
  const dir={kind:'directory',entriesMap:entries,removed,
    async *entries(){for(const row of entries)yield row},
    getDirectoryHandle:async()=>dir,
    async getFileHandle(name){
      if(!entries.has(name))entries.set(name,{kind:'file',text:'{}',lastModified:0,
        async getFile(){return {size:this.text.length,lastModified:this.lastModified,text:async()=>this.text}}});
      return entries.get(name);
    },
    async removeEntry(name){removed.push(name);entries.delete(name)},
  };
  return dir;
}
function fixture(app,t){
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,jobs=new Map();let id=0;
  globalThis.setTimeout=run=>{jobs.set(++id,run);return id};globalThis.clearTimeout=key=>jobs.delete(key);
  t.after(()=>{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear});
  const a=directory(),b=directory(),files=app==='kupa'?{backupsDirHandle:a}:{dirHandle:a};
  const key=app==='kupa'?'backupsDirHandle':'dirHandle';
  const io={async writeJsonHandle(handle,value){handle.text=JSON.stringify(value);handle.lastModified=Date.now()},
    async readJsonHandle(handle){return JSON.parse(await (await handle.getFile()).text())},
    async writeTextHandle(handle,text){handle.text=text;handle.lastModified=Date.now()}};
  const errors=[];
  const api=app==='kupa'?kupaBackup({files,model:{state:snapshot('initial')},session:{dbRevision:1,serverInfo:{}},normalizeState:x=>x,reportBackupError:message=>errors.push(message),...io}):ordersBackup({files,...io});
  const queue=app==='kupa'?api.queueAutomaticBackup:api.queueAutomaticFolderBackup;
  const save=app==='kupa'?api.maybeCreateAutomaticBackup:api.maybeCreateAutomaticFolderBackup;
  t.after(()=>{(api.runtime?.dispose??api.clearPendingAutomaticBackup??api.clearPendingAutomaticFolderBackup)()});
  async function wake(){const run=[...jobs.values()][0];assert.equal(typeof run,'function');jobs.clear();await run();await api.runtime?.drain()}
  return {api,files,key,a,b,jobs,io,queue,save,wake,errors};
}

test('Kupa optional backup failure is visible once and a later verified backup clears it',async t=>{
  t.mock.method(console,'error',()=>{});
  const f=fixture('kupa',t),get=f.a.getFileHandle.bind(f.a);
  f.a.getFileHandle=async()=>{throw Error('permission revoked')};
  for(let i=0;i<2;i++)assert.equal(await f.api.backupSnapshotToComputer(),null);
  assert.equal(f.files.backupLastError,'permission revoked');assert.equal(f.errors.length,1);
  f.a.getFileHandle=get;assert.ok(await f.api.backupSnapshotToComputer());assert.equal(f.files.backupLastError,'');
});

for(const app of ['kupa','orders'])test(`${app}: a queued backup cannot write its old payload into a newly selected folder`,async t=>{
  const f=fixture(app,t);f.queue(snapshot('old target data'),1000);f.files[f.key]=f.b;
  await f.wake();assert.equal(f.b.entriesMap.size,0);assert.equal(f.a.entriesMap.size,0);
});

test('Kupa failed verification removes only the file in the originally captured directory',async t=>{
  const f=fixture('kupa',t),entered=gate(),release=gate(),get=f.a.getFileHandle.bind(f.a),name='kupa-backup-protected.json';
  const protectedFile=await f.b.getFileHandle(name);protectedFile.text=JSON.stringify(snapshot('independent B backup'));
  f.a.getFileHandle=async(...args)=>{const file=await get(...args);entered.resolve();await release.promise;
    file.getFile=async()=>({text:async()=>JSON.stringify(snapshot('corrupted read'))});return file};
  const writing=f.api.writeVerifiedBackup(name,snapshot('A data'));await entered.promise;f.files[f.key]=f.b;release.resolve();
  await assert.rejects(writing);assert.deepEqual(f.b.removed,[]);assert.equal(f.a.entriesMap.has(name),false);
  assert.equal(protectedFile.text,JSON.stringify(snapshot('independent B backup')));
});

for(const app of ['kupa','orders'])test(`${app}: finishing an older write preserves the newer queued backup obligation`,async t=>{
  const f=fixture(app,t),entered=gate(),release=gate(),get=f.a.getFileHandle.bind(f.a);
  f.a.getFileHandle=async(...args)=>{entered.resolve();await release.promise;return get(...args)};
  const input=snapshot('accepted first'),writing=f.save(input);await entered.promise;
  input.notes[0].content='external mutation';f.queue(snapshot('accepted newer'),1000);
  release.resolve();await writing;
  assert.equal(f.jobs.size,1,'the older write must not cancel the newer deadline');
  assert.equal(JSON.parse([...f.a.entriesMap.values()][0].text).notes[0].content,'accepted first');
  f.api.runtime.cancelPending();await f.api.runtime.drain();assert.equal(f.api.runtime.isPending(),false);
});

for(const app of ['kupa','orders'])test(`${app}: disposal drains a started file write on its original target and closes new requests`,async t=>{
  const f=fixture(app,t),entered=gate(),release=gate(),get=f.a.getFileHandle.bind(f.a);
  f.a.getFileHandle=async(...args)=>{entered.resolve();await release.promise;return get(...args)};
  const writing=f.save(snapshot('accepted original'));await entered.promise;f.files[f.key]=f.b;
  assert.equal(f.api.runtime.dispose(),true);assert.equal(f.api.runtime.dispose(),false);
  let drained=false;const drain=f.api.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  release.resolve();assert.ok(await writing);await drain;
  assert.equal(f.b.entriesMap.size,0);assert.equal(JSON.parse([...f.a.entriesMap.values()][0].text).notes[0].content,'accepted original');
  assert.equal(await f.save(snapshot('closed')),null);assert.equal(f.queue(snapshot('closed'),1000),false);assert.equal(f.jobs.size,0);
});
