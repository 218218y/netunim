import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiFolders} from '../netunim-kupa/site/assets/js/ui/folders.js';
import {createUiConnection} from '../netunim-kupa/site/assets/js/ui/connection.js';
import {createLocalFileAdoption} from '../netunim-kupa/site/assets/js/storage/local-file-adoption.js';
import {createStorageBackup} from '../netunim-kupa/site/assets/js/storage/backup.js';
import {createLocalCommitOwner} from '../netunim-kupa/site/assets/js/storage/local-commit.js';
import {STORAGE_PREF_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t){
  const events=[],remembered=[],values=new Map([[STORAGE_PREF_KEY,'file']]);
  const descriptors=['localStorage','document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  t.after(()=>{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}});
  const screen={style:{display:'flex'}},element=()=>({style:{},textContent:'',innerHTML:''});
  const elements=new Map([['connectScreen',screen]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const window={};Object.defineProperties(globalThis,{localStorage:{configurable:true,value:storage},window:{configurable:true,value:window},document:{configurable:true,value:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},body:{classList:{toggle(){}}}}}});
  t.mock.method(console,'error',(...args)=>events.push(['error',args[0]]));
  const oldFile={name:'old.json'},oldRoot={name:'old-root'},oldBackup={name:'old-backup'},oldDirectory={name:'old-backups'};
  const files={dataFileHandle:oldFile,rootDirHandle:oldRoot,backupRootDirHandle:oldBackup,backupsDirHandle:oldDirectory};
  const model={state:{notes:[{id:'old'}],checks:[]}},session={connectionMode:'file',backendReady:true,dbRevision:7,serverInfo:{databaseFile:'old.json',backups:[]},lastSavedSnapshot:'old'},tab={primaryTab:true};
  let epoch=0;
  const nextState={notes:[{id:'candidate'}],checks:[]},directory={name:'candidate-backups'},dataFileHandle={name:'new.json'},root={name:'new-root',queryPermission:async()=> 'granted',getDirectoryHandle:async()=>directory};
  const source={rootDirHandle:root,backupRootDirHandle:root,dataFileHandle,backupsDirHandle:directory,connectionMode:'directory'};
  const file={files,checksSession:{},readJsonHandle:async handle=>{events.push(['read',handle]);return {state:structuredClone(nextState),_meta:{revision:12}}},captureLegacyWorkbook:async()=>{},listBackups:async handle=>{events.push(['catalog',handle]);return []},backupSnapshotToComputer:async()=>{events.push(['backup'])}};
  const journal={storageV2Primary:()=>true,storageV2Boundary:{run:async()=>events.push(['boundary'])},sharedChecksV2:{localReady:true,recover:async()=>({seq:0,state:{checks:[]}})},recoverStorageV2State:async()=>({seq:0,state:structuredClone(model.state)}),refreshStorageV2CloudState:async()=>null};
  const projection={stateFromPayload:payload=>({state:payload.state,meta:payload._meta}),domainRevisions:{reconcile:()=>events.push(['reconcile'])}};
  const adoption=createLocalFileAdoption({model,session,tab,journal,file,projection,view:{showSecondaryTabGuard:()=>{},setConnectedStatus:()=>events.push(['connected']),setSaveStatus:()=>{}}});
  const ports={files,session,tab,ui:{currentPage:'cash'},prepareDirectory:async()=>source,permissionFor:async()=>true,
    loadState:options=>adoption.loadState(options),render:()=>events.push(['render']),listBackups:handle=>file.listBackups(handle),backupSnapshotToComputer:()=>file.backupSnapshotToComputer(),toast:message=>events.push(['toast',message]),renderSettings:()=>{},
    rememberHandle:async handle=>remembered.push(['root',handle]),rememberBackupHandle:async handle=>remembered.push(['backup',handle]),getRememberedHandle:async()=>root,getRememberedBackupHandle:async()=>root,
    showSecondaryTabGuard:()=>events.push(['secondary']),showFirstRun:()=>{},showRememberedFolderPrompt:()=>{},
    captureSourceScope:()=>{const observed=epoch;return ()=>{if(observed!==epoch||!tab.primaryTab)throw Error('storage_source_scope_changed')}},drainSources:async()=>events.push(['drain']),resumeSources:()=>events.push(['resume'])};
  const create=()=>createUiFolders(ports);
  const before=()=>({files:{...files},state:structuredClone(model.state),session:{connectionMode:session.connectionMode,backendReady:session.backendReady,dbRevision:session.dbRevision,serverInfo:structuredClone(session.serverInfo),lastSavedSnapshot:session.lastSavedSnapshot},preference:values.get(STORAGE_PREF_KEY),remembered:remembered.slice(),screen:screen.style.display});
  return {create,ports,files,model,session,tab,source,file,journal,projection,root,window,storage,screen,events,remembered,values,before,changeScope:()=>{epoch++}};
}

for(const phase of ['permission','directory','read','decode','catalog','boundary'])test(`directory ${phase} failure retains all previous source state`,async t=>{
  const f=fixture(t),error=Error(`injected ${phase}`);
  if(phase==='permission')f.ports.permissionFor=async()=>{throw error};
  if(phase==='directory')f.ports.prepareDirectory=async()=>{throw error};
  if(phase==='read')f.file.readJsonHandle=async()=>{throw error};
  if(phase==='decode')f.projection.stateFromPayload=()=>{throw error};
  if(phase==='catalog')f.file.listBackups=async()=>{throw error};
  if(phase==='boundary')f.journal.storageV2Boundary.run=async()=>{throw error};
  // Recreate after substituting the file/projection ports captured by adoption.
  const adoption=createLocalFileAdoption({model:f.model,session:f.session,tab:f.tab,journal:f.journal,file:f.file,projection:f.projection,view:{showSecondaryTabGuard(){},setConnectedStatus(){},setSaveStatus(){}}});
  f.ports.loadState=options=>adoption.loadState(options);
  const before=f.before();await assert.rejects(f.create().connectDirectory(f.root),error);assert.deepEqual(f.before(),before);assert.equal(f.session.localSourceSwitchPending,false);
});

test('successful source installation follows the paired durable import in one turn',async t=>{
  const f=fixture(t),old=f.files.dataFileHandle;
  f.journal.storageV2Boundary.run=async()=>{assert.equal(f.files.dataFileHandle,old);assert.equal(f.model.state.notes[0].id,'old');f.events.push(['boundary'])};
  await f.create().connectDirectory(f.root);
  assert.equal(f.files.dataFileHandle,f.source.dataFileHandle);assert.equal(f.files.backupsDirHandle,f.source.backupsDirHandle);
  assert.equal(f.model.state.notes[0].id,'candidate');assert.equal(f.session.dbRevision,12);assert.equal(f.values.get(STORAGE_PREF_KEY),'directory');
  assert.ok(f.events.findIndex(([event])=>event==='boundary')<f.events.findIndex(([event])=>event==='connected'));assert.equal(f.screen.style.display,'none');
});

test('direct file read failure never replaces the old directory or backup handles',async t=>{
  const f=fixture(t),before=f.before();f.ports.loadState=async options=>{assert.equal(options.source.rootDirHandle,null);assert.equal(options.source.backupRootDirHandle,null);assert.equal(f.files.rootDirHandle,before.files.rootDirHandle);throw Error('file unreadable')};
  await assert.rejects(f.create().connectDataFile({name:'unreadable.json'}),/file unreadable/);assert.deepEqual(f.before(),before);
});

test('new sources wait for accepted old writes and reject overlapping transitions',async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred();f.ports.drainSources=async()=>{entered.resolve();await gate.promise};
  const api=f.create(),before=f.before(),pending=api.connectDirectory(f.root);await entered.promise;
  assert.deepEqual(f.before(),before);assert.equal(f.events.length,0);
  await assert.rejects(api.connectDataFile({name:'competing.json'}),/storage_source_transition_busy/);
  gate.resolve();await pending;assert.equal(f.files.dataFileHandle,f.source.dataFileHandle);
});

for(const action of ['account','leadership'])test(`loss of ${action} during candidate preparation prevents adoption`,async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred();f.ports.prepareDirectory=async()=>{entered.resolve();await gate.promise;return f.source};
  const before=f.before(),pending=assert.rejects(f.create().connectDirectory(f.root),/storage_source_scope_changed/);await entered.promise;
  if(action==='account')f.changeScope();else f.tab.primaryTab=false;
  gate.resolve();await pending;assert.deepEqual(f.before(),before);assert.ok(!f.events.some(([event])=>event==='boundary'));
});

test('an older folder picker cannot replace a newer completed selection',async t=>{
  const f=fixture(t),first=deferred(),second=deferred();let count=0;
  f.window.showDirectoryPicker=()=>++count===1?first.promise:second.promise;
  const api=f.create(),old=api.chooseFolder(),latest=api.chooseFolder();second.resolve(f.root);await latest;
  first.resolve({name:'obsolete'});await old;assert.equal(f.files.rootDirHandle,f.root);assert.equal(f.remembered.length,2);
});

test('automatic opening uses the same candidate import and retains old data on a mismatch',async t=>{
  const f=fixture(t),folders=f.create(),before=f.before();
  const connection=createUiConnection({session:f.session,tab:f.tab,supaConfigured:()=>false,getRememberedHandle:async()=>f.root,connectDirectory:(...args)=>folders.connectDirectory(...args)});
  assert.equal(await connection.tryAutoOpenRemembered(),true);assert.deepEqual(f.before(),before);assert.ok(!f.events.some(([event])=>event==='boundary'));
});

test('remembered backup directory failure retains the current backup source',async t=>{
  const f=fixture(t),before=f.before();f.root.getDirectoryHandle=async()=>{throw Error('backup inaccessible')};
  assert.equal(await f.create().restoreRememberedBackupTarget(),false);assert.deepEqual(f.before(),before);
});

test('preference persistence failure reports the accepted source without rolling it back',async t=>{
  const f=fixture(t);f.storage.setItem=()=>{throw Error('preference quota')};
  assert.equal(await f.create().connectDirectory(f.root),true);assert.equal(f.files.rootDirHandle,f.root);assert.equal(f.model.state.notes[0].id,'candidate');
  assert.ok(f.events.some(([event,message])=>event==='toast'&&message.includes('לא נשמרה')));
});

test('directory preparation never changes live backup handles even if the file open fails',async()=>{
  const files={backupsDirHandle:{name:'old-backups'},backupRootDirHandle:{name:'old-root'}},before={...files};
  const api=createStorageBackup({files,model:{state:{}},session:{},normalizeState:value=>value,writeJsonHandle:async()=>{},readJsonHandle:async()=>null});
  const root={getDirectoryHandle:async name=>name==='backups'?{name:'candidate-backups'}:{getFileHandle:async()=>{throw Error('file open denied')}}};
  await assert.rejects(api.prepareDirectory(root),/file open denied/);assert.deepEqual(files,before);
});

test('new business saves cannot enter while a source transition is pending',async()=>{
  let statuses=0;
  const session={localSourceSwitchPending:true,localGeneration:8};
  const owner=createLocalCommitOwner({model:{state:{}},session,tab:{primaryTab:true},journal:{},projection:{},publication:{},view:{setSaveStatus:()=>{statuses++}}});
  assert.equal(await owner.saveStateAccepted('pending source'),false);
  assert.equal(session.localGeneration,8);assert.equal(statuses,1);
});
