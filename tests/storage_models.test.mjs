import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageFiles as kupaFiles} from '../netunim-kupa/site/assets/js/storage/files.js';
import {createStorageFiles as orderFiles} from '../netunim-orders/site/assets/js/storage/files.js';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';

function memoryFile(initial='{}'){
 let text=initial,active=0,maxActive=0;
 return {kind:'file',get text(){return text},get maxActive(){return maxActive},
   getFile:async()=>({text:async()=>text}),
   createWritable:async()=>{active++;maxActive=Math.max(active,maxActive);let next;return {
     write:async value=>{await new Promise(r=>setTimeout(r,2));next=value},
     close:async()=>{text=next;active--}
   }}
 };
}
function memoryDirectory(){
 const files=new Map(),dirs=new Map();
 return {kind:'directory',files,dirs,queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
   getFileHandle:async(name,{create=false}={})=>{if(!files.has(name)){if(!create)throw new DOMException('missing','NotFoundError');files.set(name,memoryFile())}return files.get(name)},
   getDirectoryHandle:async(name,{create=false}={})=>{if(!dirs.has(name)){if(!create)throw new DOMException('missing','NotFoundError');dirs.set(name,memoryDirectory())}return dirs.get(name)}
 };
}

test('Kupa verified file writes detect corruption and preserve revision',async()=>{
 const api=kupaFiles({}),payload={version:4,cash:[],checks:[],credits:[],expenses:[],cards:[],_meta:{revision:8}};
 const file=memoryFile();assert.deepEqual(await api.writeJsonHandleVerified(file,payload),payload);
 const broken={...file,getFile:async()=>({text:async()=>JSON.stringify({...payload,_meta:{revision:7}})})};
 await assert.rejects(api.writeJsonHandleVerified(broken,payload));
 const denied={createWritable:async()=>{throw new DOMException('denied','NotAllowedError')}};
 await assert.rejects(api.writeJsonHandleVerified(denied,payload),{name:'NotAllowedError'});
});

test('permission prompts are explicit and revocation fails safely',async()=>{
 let prompts=0;const directory=memoryDirectory();directory.queryPermission=async()=> 'prompt';directory.requestPermission=async()=>{prompts++;return 'denied'};
 const {files,tab}=createContexts();files.dirHandle=directory;
 const api=orderFiles({files,tab,syncFolderAccessButton:()=>{}});
 assert.equal(await api.refreshDirPermission(false),false);assert.equal(prompts,0);
 assert.equal(await api.refreshDirPermission(true),false);assert.equal(prompts,1);
 assert.equal(await api.writeStateToFolder(),false);
 assert.equal(await kupaFiles({}).permissionFor(directory),false);assert.equal(prompts,2);
});

test('Orders folder writes serialize and back up pre-existing data before replacement',async()=>{
 const {files,tab}=createContexts(),directory=memoryDirectory();files.dirHandle=directory;files.dirPermission='granted';
 const data=await directory.getDirectoryHandle('data',{create:true});
 const old={version:4,businessName:'old',suppliers:[],transactions:[]};
 data.files.set('orders-data.json',memoryFile(JSON.stringify(old)));
 let snapshot={...old,businessName:'first'},backups=[];
 const api=orderFiles({files,tab,syncFolderAccessButton:()=>{},prepareState:()=>structuredClone(snapshot),
   writeVerifiedFolderBackup:async(_dir,name,payload)=>{backups.push({name,payload:structuredClone(payload)})},maybeCreateAutomaticFolderBackup:async()=>{}});
 const first=api.writeStateToFolder();snapshot={...old,businessName:'latest'};const second=api.writeStateToFolder(true);
 assert.deepEqual(await Promise.all([first,second]),[true,true]);
 const file=data.files.get('orders-data.json');assert.equal(file.maxActive,1);
 assert.equal(JSON.parse(file.text).businessName,'latest');
 assert.equal(backups[0].payload.businessName,'old');assert.ok(backups[0].name.includes('before-connect'));
 assert.equal(backups.at(-1).payload.businessName,'latest');assert.equal(files.folderWritePromise,null);
});
