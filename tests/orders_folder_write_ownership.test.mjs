import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageFiles} from '../netunim-orders/site/assets/js/storage/files.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const snapshot=name=>({version:4,businessName:name,notes:[{id:'retained-note',content:name}]});
function directory(){
  const entries=new Map(),dirs=new Map();
  return {entriesMap:entries,dirs,queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
    async getDirectoryHandle(name,{create=false}={}){
      if(!dirs.has(name)){if(!create)throw new DOMException('missing','NotFoundError');dirs.set(name,directory())}
      return dirs.get(name);
    },
    async getFileHandle(name,{create=false}={}){
      if(!entries.has(name)){
        if(!create)throw new DOMException('missing','NotFoundError');
        let text='{}',active=0,maxActive=0;
        entries.set(name,{kind:'file',get text(){return text},get maxActive(){return maxActive},getFile:async()=>({text:async()=>text}),
          async createWritable(){active++;maxActive=Math.max(active,maxActive);let next;
            return {write:async value=>{await Promise.resolve();next=value},close:async()=>{text=next;active--}}}});
      }
      return entries.get(name);
    }};
}
function fixture(){
  const a=directory(),b=directory(),files={dirHandle:a,dirPermission:'granted',folderLastError:''},tab={primaryTab:true},backups=[];
  let state=snapshot('current');
  const api=createStorageFiles({files,tab,prepareState:()=>structuredClone(state),syncFolderAccessButton:()=>{},
    writeVerifiedFolderBackup:async(dir,name,payload)=>{backups.push({dir,name,payload:structuredClone(payload)});return name},
    maybeCreateAutomaticFolderBackup:async()=>null});
  return {a,b,files,tab,api,backups,setState:value=>{state=value}};
}
test('a held permission result cannot grant or write the newly selected directory',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  f.a.queryPermission=()=>{entered.resolve();return held.promise};
  const writing=f.api.writeStateSnapshotToFolder(snapshot('A input'));await entered.promise;
  f.files.dirHandle=f.b;f.files.dirPermission='prompt';held.resolve('granted');
  await writing;
  assert.equal(f.files.dirPermission,'prompt');assert.equal(f.b.dirs.size,0);
});
test('a started working-file stream keeps its captured target for backups after a folder change',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  const data=await f.a.getDirectoryHandle('data',{create:true}),file=await data.getFileHandle('orders-data.json',{create:true});
  const create=file.createWritable.bind(file);
  file.createWritable=async()=>{const stream=await create();return {...stream,close:async()=>{entered.resolve();await held.promise;await stream.close()}}};
  const writing=f.api.writeStateSnapshotToFolder(snapshot('captured A input'),true);await entered.promise;
  f.files.dirHandle=f.b;f.files.dirPermission='prompt';held.resolve();await writing;
  assert.equal(f.b.dirs.size,0);assert.equal(JSON.parse(file.text).businessName,'captured A input');
  assert.ok(f.backups.every(row=>row.dir!==f.b.dirs.get('backups')));
});
test('explicit restore snapshots and ordinary mirrors share one working-file writer',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  const data=await f.a.getDirectoryHandle('data',{create:true}),file=await data.getFileHandle('orders-data.json',{create:true});
  const create=file.createWritable.bind(file);let calls=0;
  file.createWritable=async()=>{const stream=await create();if(++calls!==1)return stream;return {...stream,close:async()=>{entered.resolve();await held.promise;await stream.close()}}};
  const first=f.api.writeStateToFolder();await entered.promise;
  const restore=f.api.writeStateSnapshotToFolder(snapshot('protected restore snapshot'),true);
  try{for(let i=0;i<35;i++)await Promise.resolve();assert.equal(calls,1,'a restore must wait for the ordinary mirror')}
  finally{held.resolve();await Promise.allSettled([first,restore])}
  assert.equal(file.maxActive,1);assert.equal(JSON.parse(file.text).businessName,'protected restore snapshot');
});

test('snapshot input is detached before permission preflight and preservation compares that input',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  f.setState(snapshot('existing'));
  const data=await f.a.getDirectoryHandle('data',{create:true}),file=await data.getFileHandle('orders-data.json',{create:true});
  const stream=await file.createWritable();await stream.write(JSON.stringify(snapshot('existing')));await stream.close();
  f.a.queryPermission=()=>{entered.resolve();return held.promise};
  const input=snapshot('explicit safety input'),writing=f.api.writeStateSnapshotToFolder(input,true);await entered.promise;
  input.businessName='mutated after capture';held.resolve('granted');assert.equal(await writing,true);
  assert.equal(JSON.parse(file.text).businessName,'explicit safety input');
  assert.equal(f.backups[0].payload.businessName,'existing');assert.match(f.backups[0].name,/before-connect/);
});

test('reselecting a directory rechecks its independent pre-existing state',async()=>{
  const f=fixture();assert.equal(await f.api.writeStateToFolder(),true);
  const data=await f.a.getDirectoryHandle('data'),file=await data.getFileHandle('orders-data.json');
  const stream=await file.createWritable();await stream.write(JSON.stringify(snapshot('external replacement')));await stream.close();
  const oldCurrent=f.api.captureSelection();f.api.selectDirectory(f.a);
  assert.equal(oldCurrent(),false);assert.equal(await f.api.refreshDirPermission(),true);
  assert.equal(await f.api.writeStateToFolder(),true);
  assert.equal(f.backups.at(-1).payload.businessName,'external replacement');
});

test('source quiescence fences held permission publication and waits for its completion',async()=>{
  const f=fixture(),entered=gate(),held=gate();f.files.dirPermission='prompt';
  f.a.queryPermission=()=>{entered.resolve();return held.promise};
  const current=f.api.captureSelection(),permission=f.api.refreshDirPermission();await entered.promise;
  f.api.runtime.cancelPending();let drained=false;const drain=f.api.runtime.drain().then(()=>{drained=true});
  await Promise.resolve();assert.equal(drained,false);assert.equal(current(),false);
  held.resolve('granted');assert.equal(await permission,false);await drain;assert.equal(f.files.dirPermission,'prompt');
});

test('old permission lookup cannot prompt a newly selected folder',async()=>{
  const f=fixture(),entered=gate(),held=gate();let prompts=0;
  f.a.queryPermission=()=>{entered.resolve();return held.promise};f.b.requestPermission=async()=>{prompts++;return 'granted'};
  const permission=f.api.refreshDirPermission(true);await entered.promise;f.api.selectDirectory(f.b);held.resolve('prompt');
  assert.equal(await permission,false);assert.equal(prompts,0);assert.equal(f.files.dirPermission,'unknown');
});

test('disposal rejects later folder selections as well as writes and queries',async()=>{
  const f=fixture();assert.equal(f.api.runtime.dispose(),true);assert.equal(f.api.runtime.dispose(),false);
  assert.equal(f.api.selectDirectory(f.b),false);assert.equal(f.files.dirHandle,f.a);
  assert.equal(await f.api.refreshDirPermission(true),false);
  assert.equal(await f.api.writeStateSnapshotToFolder(snapshot('closed'),true),false);assert.equal(f.a.dirs.size,0);
});
