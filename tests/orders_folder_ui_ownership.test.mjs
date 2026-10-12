import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiFolders} from '../netunim-orders/site/assets/js/ui/folders.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(){
  const files={dirHandle:{name:'A'},folderLastError:'independent status'},tab={primaryTab:true},events=[];
  const ports={
    authority:{isPrimary:()=>tab.primaryTab,rejectSecondary:()=>{}},
    selection:{available:()=>!!files.dirHandle,select:handle=>{files.dirHandle=handle;return true},capture:()=>{const target=files.dirHandle;return ()=>files.dirHandle===target&&tab.primaryTab}},
    persistence:{requestPersistence:async()=>{},refreshPermission:async()=>true,preserve:async()=>{events.push('preserve');return true},write:async()=>{events.push('write');return true},saveDirectory:async()=>{}},
    picker:{isAvailable:()=>true,pick:async()=>({name:'picked'})},
    view:{success:message=>events.push(message),failure:(error,message)=>{files.folderLastError=error.message;events.push(message)},toast:message=>events.push(message)},
  };
  return {files,tab,events,ports};
}
test('activation stops after a held browser-storage grant when another folder is selected',async()=>{
  const f=fixture(),held=gate();f.ports.persistence.requestPersistence=()=>held.promise;
  const api=createUiFolders(f.ports),activating=api.activateSavedFolder();f.files.dirHandle={name:'B'};held.resolve();await activating;
  assert.deepEqual(f.events,[]);assert.equal(f.files.folderLastError,'independent status');
});
test('an old failed backup receipt cannot overwrite the newer folder status',async()=>{
  const f=fixture(),entered=gate(),held=gate();f.ports.persistence.write=()=>{entered.resolve();return held.promise};
  const api=createUiFolders(f.ports),backup=api.backupToFolder();await entered.promise;f.files.dirHandle={name:'B'};held.resolve(false);await backup;
  assert.deepEqual(f.events,[]);assert.equal(f.files.folderLastError,'independent status');
});
test('loss of primary ownership during permission confirmation prevents later writes',async()=>{
  const f=fixture(),held=gate();f.ports.persistence.refreshPermission=()=>held.promise;
  const api=createUiFolders(f.ports),backup=api.backupToFolder();f.tab.primaryTab=false;held.resolve(true);await backup;
  assert.deepEqual(f.events,[]);
});

test('a superseded picker cannot replace the directory selected by a newer picker',async()=>{
  const f=fixture(),first=gate(),second=gate();let picks=0;
  f.ports.picker.pick=()=>++picks===1?first.promise:second.promise;
  const api=createUiFolders(f.ports),old=api.chooseFolder(),latest=api.chooseFolder();
  second.resolve({name:'new selection'});await latest;
  first.resolve({name:'old selection'});await old;
  assert.equal(f.files.dirHandle.name,'new selection');assert.equal(f.events.filter(event=>event==='write').length,1);
});
