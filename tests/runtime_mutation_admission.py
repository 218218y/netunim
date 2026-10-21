"""Production save owners: explicit drafts, native IDB aborts, export and reload."""
import json
import argparse
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
  await appReady;const app=APP,kupa=app==='kupa',fault=FAULT;
  if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}
  else{finance.runtime.stop();syncDocument.stopPolling()}
  const check=(value,label)=>{if(!value)throw Error(label)},noop=()=>{};
  const id='admission-'+fault,record={id,content:'durable original',createdAt:'2026-10-21',updatedAt:'2026-10-21'};
  const options=()=>({domains:['notes'],operations:[{type:'put',collection:'notes',id,mode:'replace',record:state.notes.find(row=>row.id===id)}]});
  const save=options=>kupa?storagePersistence.saveState('edit',options):storagePersistence.scheduleSave('edit',options);
  state.notes.push(record);
  await save({operations:[{type:'put',collection:'notes',id,mode:'insert',index:state.notes.length-1,record}]});
  await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending?.();await storagePersistence.runtime.drain();
  let protectedFile=null,protectedText='';
  if(!kupa){
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('admission-mirror-'+fault,{create:true});
    storageFiles.selectDirectory({queryPermission:async()=> 'granted',getDirectoryHandle:(...args)=>directory.getDirectoryHandle(...args)});
    await storageFiles.refreshDirPermission();
    check(await storageFiles.writeStateToFolder(),'durable initial mirror was not confirmed');
    const data=await directory.getDirectoryHandle('data');protectedFile=await data.getFileHandle('orders-data.json');
    protectedText=await (await protectedFile.getFile()).text();
    check(JSON.parse(protectedText).notes.some(row=>row.id===id&&row.content==='durable original'),'initial mirror content');
    const proof=await storageV2Coordinator.captureFolderState(),accountScope=cloudAuth.getAccountScope;
    check(!!proof&&proof.current(),'fresh durable mirror proof');
    try{
      cloudAuth.getAccountScope=()=>({owner:'replacement-account',epoch:999});
      check(!proof.current(),'mirror proof survived an authentication scope change');
    }finally{cloudAuth.getAccountScope=accountScope}
    state.notes.find(row=>row.id===id).content='unadmitted same-generation draft';
    check(!proof.current()&&await storageFiles.writeStateToFolder()===false,'unadmitted visible mutation bypassed durable proof');
    check(await (await protectedFile.getFile()).text()===protectedText,'unadmitted draft changed the last good native file');
    state.notes.find(row=>row.id===id).content='durable original';
  }
  const method=kupa?'persistImmediateBrowserSnapshot':'localSnapshot',original=storageBrowser[method],set=Storage.prototype.setItem,put=IDBObjectStore.prototype.put,error=console.error;
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
  const mainBefore=JSON.stringify(await db.load('local:'+app)),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
  const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let exported=null;
  try{
    console.error=noop;
    if(fault==='validation'){
      check(kupa,'validation scenario belongs to Kupa');
      const invalid={id:'duplicate-check',name:'invalid draft',amount:10,status:'בקופה',account:'עסקי',dueDate:'2026-10-21'};
      state.checks.push(invalid,{...invalid});
    }else if(fault==='synchronous')storageBrowser[method]=()=>{throw Error('storage_v2_write_unavailable')};
    else{
      Storage.prototype.setItem=function(key,value){if(String(key).startsWith('netunim-storage-v2-emergency:'))throw Error('emergency unavailable');return set.call(this,key,value)};
      IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==='journal'&&args[1]?.[0]==='local:'+app){this.transaction.abort();throw Error('injected native journal abort')}return result};
    }
    record.content='visible draft without durable admission';state.notes.find(row=>row.id===id).content=record.content;
    await save(options());storagePersistence.runtime.cancelPending?.();await storagePersistence.runtime.drain();
    check([...session.localUndurableGenerations].some(token=>String(token).startsWith('failed:')),'failure lacks unload/draft marker');
    if(fault==='validation')check(JSON.stringify(await db.load('local:'+app))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'validation failure wrote invalid state to a journal');
    if(kupa){uiStatus.setSaveStatus('saved','ok');uiStatus.setCloudHeaderStatus('synced','synced')}
    else{uiStatus.setSave('saved');uiStatus.setCloud('synced','synced')}
    const indicator=document.getElementById(kupa?'saveIndicator':'savePill');
    check(indicator.textContent.includes('לא נשמר')&&!indicator.hidden,'false saved indicator');
    check(state.notes.find(row=>row.id===id).content===record.content,'draft was rolled back');
    if(!kupa){
      check(await storageFiles.writeStateToFolder()===false,'a failed draft was admitted by an independent mirror trigger');
      await storageFiles.runtime.drain();
      check(await (await protectedFile.getFile()).text()===protectedText,'failed draft replaced the exact last good native file');
    }
    URL.createObjectURL=function(blob){exported=blob;return create.call(this,blob)};HTMLAnchorElement.prototype.click=noop;
    if(kupa)uiBackup.downloadJsonBackup();else uiBackup.exportJson();
    await uiBackup.runtime.drain();
    check(exported&&JSON.parse(await exported.text()).notes.some(row=>row.id===id&&row.content===record.content),'production JSON export lost draft');
    if(fault==='validation'){
      check(JSON.parse(await exported.text()).checks.filter(row=>row.id==='duplicate-check').length===2,'draft export silently repaired invalid user data');
      state.notes.find(row=>row.id===id).content='durable original';state.checks.pop();
      check(await storageV2Coordinator.confirmVisibleState()===false,'Main equality hid a valid but unjournaled Shared draft');
      check(state.checks.some(row=>row.id==='duplicate-check'),'durable proof mutated the visible draft');
    }
  }finally{storageBrowser[method]=original;Storage.prototype.setItem=set;IDBObjectStore.prototype.put=put;console.error=error;URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
  return {id,expected:'durable original'};
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=['orders','kupa'])
parser.add_argument('--fault',choices=['synchronous','native-abort','validation'])
options=parser.parse_args()
for app in ([options.app] if options.app else ('orders','kupa')):
    for fault in ([options.fault] if options.fault else (('synchronous','native-abort','validation') if app=='kupa' else ('synchronous','native-abort'))):
        with BrowserSession(ROOT/f'netunim-{app}/site',f'{app}-mutation-{fault}') as browser:
            result=browser.evaluate(FLOW.replace('APP',json.dumps(app)).replace('FAULT',json.dumps(fault)),timeout=45)
            browser._navigate();browser.evaluate('appReady.then(()=>true)')
            rows=browser.evaluate('state.notes.filter(row=>row.id==='+json.dumps(result['id'])+')')
            assert len(rows)==1 and rows[0]['content']==result['expected'],rows
            assert browser.evaluate('!session.localUndurableGenerations?.size')
            errors=browser.drain_serious_errors()
            assert all(error.startswith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture") for error in errors),errors
            print(f'PASS {app}/{fault}: visible unsaved draft, real JSON export and exact durable reload',flush=True)
