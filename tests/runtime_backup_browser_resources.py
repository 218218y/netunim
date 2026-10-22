"""Real backup composition, native input/Blob resources and V2 journals; no user files."""
import argparse
import json
import hashlib
import time
from browser_harness import BrowserSession, ROOT
from acceptance_safety import write_evidence

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('orders','kupa'))
parser.add_argument('--phase',choices=('read-dispose','read-account','confirmation','success','downloads','roundtrip','legacy'),action='append')
args=parser.parse_args()

FLOW=r"""(async()=>{
 await appReady;const app=__APP__,phase=__PHASE__,kupa=app==='kupa',check=(ok,message)=>{if(!ok)throw Error(message)};
 if(kupa){syncDocument.stopCloudPolling();bank.runtime.stop();credit.runtime.stop()}else{syncDocument.stopPolling();finance.runtime.stop()}
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 const note={id:'backup-resource-note',content:'original durable value'};state.notes.push(note);
 const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,record:note,mode:'insert',index:state.notes.length-1}]};
 if(kupa)await storagePersistence.saveState('fixture',options);else storagePersistence.scheduleSave('fixture',options);
 await mainStorageV2.commitPromise;if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:'+app),shared:await db.load('local:shared-checks')}),before=await raw();
 const target=structuredClone(state);target.notes.find(row=>row.id===note.id).content='restored file content';
 const payload=kupa?(await import('./assets/js/state/serialization.js')).payloadFromState(target,session.dbRevision):stateSelectors.prepareState(target),text=JSON.stringify(payload);
 const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}},held=deferred(),entered=deferred(),confirmed=deferred();
 const nativeInputClick=HTMLInputElement.prototype.click,nativeAnchorClick=HTMLAnchorElement.prototype.click,nativeCreate=URL.createObjectURL,nativeRevoke=URL.revokeObjectURL;
 const urls=new Set(),inputs=new Set();let selected=null;
 HTMLInputElement.prototype.click=function(){if(this.type==='file'){selected=this;inputs.add(this);return}return nativeInputClick.call(this)};
 HTMLAnchorElement.prototype.click=function(){};
 URL.createObjectURL=function(blob){const href=nativeCreate.call(this,blob);urls.add(href);return href};
 URL.revokeObjectURL=function(href){urls.delete(href);return nativeRevoke.call(this,href)};
 const sessionSave=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;
 const file={name:'synthetic-backup.json',size:text.length,text:async()=>{entered.resolve();if(phase.startsWith('read-'))await held.promise;return text}};
 async function start(){
   const selecting=kupa?uiBackup.beginRestoreBackup():uiBackup.beginJsonRestore();check(selected,'Backup did not create native input');
   Object.defineProperty(selected,'files',{value:[file],configurable:true});selected.dispatchEvent(new Event('change'));
   return await selecting;
 }
 try{
   if(phase==='downloads'){
     for(let i=0;i<50;i++){if(kupa)uiBackup.downloadJsonBackup();else uiBackup.exportJson();uiBackup.runtime.cancelPending();check(!urls.size,'download URL retained after cutover')}
     if(!kupa){const picking=uiBackup.beginJsonRestore();check(selected.isConnected,'picker missing');uiBackup.runtime.cancelPending();await picking;check(!selected.isConnected,'picker retained after cancellation')}
     check(await raw()===before,'download ownership changed durable data');
     return {phase,cycles:50,urls:urls.size};
   }
   if(phase.startsWith('read-')){
     const reading=start();await entered.promise;
     if(phase==='read-dispose')uiBackup.runtime.dispose();else sessionSave({user:{id:'replacement-account'},access_token:'synthetic',expires_at:9999999999});
     let drained=false;const drain=uiBackup.runtime.drain().then(()=>drained=true);for(let i=0;i<20;i++)await Promise.resolve();
     check(!drained&&uiBackup.runtime.isPending(),'accepted file read abandoned before bytes settled');
     held.resolve();await reading;await drain;
     check(!ui.pendingJsonRestore&&!document.querySelector('.backup-json-preview'),'obsolete file published a restore preview');
     check(await raw()===before&&state.notes.find(row=>row.id===note.id).content===note.content,'obsolete file changed visible or durable data');
   }else{
     uiModal.confirmDialog=async()=>{confirmed.resolve();if(phase==='confirmation')await held.promise;return true};
     let restoring;
     if(kupa)restoring=start();else{await start();check(ui.pendingJsonRestore,'Orders preview missing');restoring=uiBackup.applyJsonRestore()}
     await confirmed.promise;
     if(phase==='confirmation'){
       uiBackup.runtime.dispose();let drained=false;const drain=uiBackup.runtime.drain().then(()=>drained=true);for(let i=0;i<20;i++)await Promise.resolve();
       check(!drained,'accepted restore confirmation escaped drain');held.resolve();await restoring;await drain;
       check(await raw()===before,'disposed confirmation wrote a journal');
     }else{
       await restoring;await uiBackup.runtime.drain();
       const recovered=await mainStorageV2.recoverForOwner({intent:'load-account'});
       check(state.notes.find(row=>row.id===note.id).content==='restored file content'&&recovered.state.notes.find(row=>row.id===note.id).content==='restored file content','valid file import lost committed content: '+JSON.stringify({target:payload.notes,visible:state.notes,recovered:recovered.state.notes,pending:!!ui.pendingJsonRestore}));
     }
   }
   check([...inputs].every(input=>!input.isConnected),'native input retained');uiBackup.runtime.dispose();check(!urls.size,'disposed backup retained URL');
   return {phase,drained:true,retained:phase!=='success',restored:phase==='success'};
 }finally{
   uiBackup.runtime.dispose();HTMLInputElement.prototype.click=nativeInputClick;HTMLAnchorElement.prototype.click=nativeAnchorClick;URL.createObjectURL=nativeCreate;URL.revokeObjectURL=nativeRevoke;
 }
})()"""

def import_native_file(target, backup, app):
    bookmark = len(target.events)
    assert 'error' not in target.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    target.evaluate("(()=>{uiModal.confirmDialog=async()=>true;window.alert=()=>{};window.fileRoundtrip="
                    +('uiBackup.beginRestoreBackup()' if app=='kupa' else 'uiBackup.beginJsonRestore()')+';return true})()', user_gesture=True)
    deadline = time.monotonic()+5
    chooser = None
    while time.monotonic() < deadline:
        chooser = next((event['params'] for event in target.events[bookmark:] if event.get('method')=='Page.fileChooserOpened'), None)
        if chooser:
            break
        target.evaluate('true')
        time.sleep(.02)
    assert chooser and chooser.get('backendNodeId'), 'native file chooser missing'
    response = target.call('DOM.setFileInputFiles', {'files': [str(backup.resolve())], 'backendNodeId': chooser['backendNodeId']})
    assert 'error' not in response, response
    if app == 'orders':
        accepted = target.evaluate("(async()=>{const opened=await fileRoundtrip;if(!opened)return false;document.getElementById('restoreJsonChecks').checked=true;await uiBackup.applyJsonRestore();return true})()")
    else:
        accepted = target.evaluate('fileRoundtrip')
    target.evaluate('uiBackup.runtime.drain().then(()=>true)')
    return accepted


def roundtrip(app):
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-backup-export') as source:
        exported = source.evaluate(r"""(async()=>{
          await appReady;const app=__APP__,kupa=app==='kupa';
          const note={id:'roundtrip-note',content:'synthetic exported note',createdAt:'',updatedAt:''};state.notes.push(note);
          const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
          if(kupa)await storagePersistence.saveState('fixture',options);else storagePersistence.scheduleSave('fixture',options);
          await mainStorageV2.commitPromise;if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
          const {normalizeSharedChecks}=await import('./assets/js/shared/shared-checks-contract.js');
          const check=normalizeSharedChecks([{id:'roundtrip-check',amount:123,name:'Synthetic check',dueDate:'2026-10-22'}])[0];state.checks.push(check);
          await sharedChecksV2.persist([{type:'put',collection:'checks',id:check.id,mode:'insert',index:state.checks.length-1,record:check}],{surface:'test.backup-roundtrip'}).committed;
          if(kupa)uiBackup.downloadJsonBackup();else uiBackup.exportJson();
          return {note,check};
        })()""".replace('__APP__', json.dumps(app)))
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            files = list(source.downloads.glob(app+'-backup*.json'))
            if len(files) == 1:
                break
            time.sleep(.05)
        assert len(files) == 1, 'actual backup download missing'
        backup = files[0].resolve()
        assert backup.is_relative_to(source.downloads.resolve())
        payload = json.loads(backup.read_text(encoding='utf8'))
        assert next(row for row in payload['notes'] if row['id']=='roundtrip-note') == exported['note']
        assert next(row for row in payload['checks'] if row['id']=='roundtrip-check') == exported['check']
        backup_hash = hashlib.sha256(backup.read_bytes()).hexdigest()
        with BrowserSession(ROOT/f'netunim-{app}/site', app+'-backup-import') as target:
            assert import_native_file(target, backup, app) is True
            inspect = r"""(async()=>{
              await appReady;
              const main=await mainStorageV2.recoverForOwner({intent:'load-account'}),shared=await sharedChecksV2.recover();
              return {note:main.state.notes.find(row=>row.id==='roundtrip-note'),checks:shared.state.checks.filter(row=>row.id==='roundtrip-check')};
            })()"""
            before = target.evaluate(inspect)
            assert before['note'] == exported['note'] and before['checks'] == [exported['check']], {'actual':before,'exported':exported}
            target.restart_process(crash=True)
            assert target.evaluate(inspect) == before
            assert not target.drain_serious_errors()
        write_evidence(app+'-backup-file-roundtrip', [{'scenario': 'actual UI download / native file chooser / Main and Shared restore / hard process restart',
                       'status': 'PASS', 'backup_sha256': backup_hash, 'note_id': exported['note']['id'],
                       'check_id': exported['check']['id'], 'check_count_after_restart': 1}])
        print('PASS', app, 'actual synthetic backup file roundtrip and paired journals after hard process restart', flush=True)


def legacy_roundtrip(app):
    name = 'orders-v3.json' if app == 'orders' else 'kupa-v5.json'
    fixture = ROOT/'tests/fixtures/backups'/name
    payload = json.loads(fixture.read_text(encoding='utf8'))
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-legacy-backup') as target:
        backup = target.downloads/name
        backup.write_bytes(fixture.read_bytes())
        assert import_native_file(target, backup, app) is True
        inspect = r"""(async()=>{
          await appReady;
          const main=await mainStorageV2.recoverForOwner({intent:'load-account'}),shared=await sharedChecksV2.recover();
          return {state:main.state,checks:shared.state.checks};
        })()"""
        before = target.evaluate(inspect)
        assert before['state']['version'] == 4
        assert before['state']['notes'] == [{'id':'LEGACY-NOTE','content':'Synthetic earlier note','createdAt':'','updatedAt':''}]
        assert len(before['checks']) == 1 and before['checks'][0]['id'] == 'LEGACY-CHECK' and before['checks'][0]['amount'] == 0
        if app == 'kupa':
            assert len(before['state']['cash']) == 1 and before['state']['cash'][0]['amount'] == 125
            assert before['state']['bank']['currentBalance'] is None
            assert len(before['state']['cards']) == 1 and before['state']['cards'][0]['id']
        else:
            assert len(before['state']['transactions']) == 1 and before['state']['transactions'][0]['debit'] == 125
        target.restart_process(crash=True)
        assert target.evaluate(inspect) == before
        assert not target.drain_serious_errors()
        raw = "(async()=>{const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb();return JSON.stringify({main:await db.load('local:"+app+"'),shared:await db.load('local:shared-checks')})})()"
        stored = target.evaluate(raw)
        for kind, changes in [('future', {'version':99}), ('foreign', {'_meta': {'format': 'kupa-portable' if app=='orders' else 'order-management-portable'}})]:
            invalid = target.downloads/(kind+'.json')
            invalid.write_text(json.dumps({**payload, **changes}),encoding='utf8')
            assert import_native_file(target, invalid, app) is False
            assert target.evaluate(raw) == stored
            # The UI intentionally logs rejected input; journal identity/state
            # equality above, not an absence of console logs, proves refusal.
            target.drain_serious_errors()
        write_evidence(app+'-legacy-backup', [{'scenario':name+' native import and hard process restart','status':'PASS',
                       'fixture_sha256':hashlib.sha256(fixture.read_bytes()).hexdigest(), 'financial_record_count':1,
                       'zero_check_count':1, 'future_and_foreign_input_unchanged_journals':True}])
        print('PASS',app,'earlier-schema file, restart, stable identity/zero money and future/foreign refusal',flush=True)


for app in (args.app,) if args.app else ('orders','kupa'):
    for phase in args.phase or ('read-dispose','read-account','confirmation','success','downloads','roundtrip','legacy'):
        if phase == 'roundtrip':
            roundtrip(app)
            continue
        if phase == 'legacy':
            legacy_roundtrip(app)
            continue
        with BrowserSession(ROOT/f'netunim-{app}/site',f'backup-resources-{app}-{phase}') as browser:
            result=browser.evaluate(FLOW.replace('__APP__',json.dumps(app)).replace('__PHASE__',json.dumps(phase)),timeout=45)
            errors=browser.drain_serious_errors()
            assert not errors,errors
            print('PASS native backup resources '+app+': '+json.dumps(result),flush=True)
