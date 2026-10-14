"""Stale restore approval preserves a later edit and both native journals."""
from browser_harness import BrowserSession, ROOT
import json
import argparse

parser=argparse.ArgumentParser()
parser.add_argument('--baseline',action='store_true',help='Remove review guards in the disposable site; regression must fail.')
args=parser.parse_args()

for app in ('orders', 'kupa'):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-restore-review-scope',auto_navigate=False) as browser:
        if args.baseline:
            target=browser.tmp/'site/assets/js/ui/backup-restore.js'
            target.write_text(target.read_text(encoding='utf-8').replace('reviewScope.assertCurrent(review);',''),encoding='utf-8')
        browser._navigate()
        result = browser.evaluate(r"""(async()=>{
          await appReady;const app=APP,kupa=app==='kupa',clone=structuredClone,noop=()=>{};
          const {createBackupRestore}=await import('./assets/js/ui/backup-restore.js');
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const note={id:'restore-scope-note',content:'before approval'};state.notes.push(note);
          const insert={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
          if(kupa)await storagePersistence.saveState('restore fixture',insert);else storagePersistence.scheduleSave('restore fixture',insert);
          await mainStorageV2.commitPromise;
          if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
          const target=clone(state);target.notes.find(row=>row.id===note.id).content='historical backup';
          let approve;
          const restore=createBackupRestore({model,session,tab,checksSession,files:{},
            projection:{normalizeState:stateNormalization.normalizeState,prepareState:()=>clone(state)},
            view:{confirmDialog:()=>new Promise(resolve=>{approve=resolve}),toast:noop,render:noop,invalidateAllViewDomains:noop},
            local:{folderBackupAvailable:()=>false},cloud:{cloudEnabled:()=>false},
            storage:{...storageV2Cloud,storageV2LocalPrimary:()=>mainStorageV2.primaryReady,
              storageOwnerCurrent:()=>storageOwner.current(),storageV2Boundary:sharedChecksV2Composition.boundary,sharedChecksV2,
              recoverStorageV2State:()=>mainStorageV2.recoverForOwner({intent:'load-account'})},
          });
          const restoring=(kupa?restore.restoreState:restore.restoreNormalizedState)(target,{beforeDownload:false});
          note.content='exact edit during restore approval';
          const edit={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'replace',record:note}]};
          if(kupa)await storagePersistence.saveState('later note',edit);else storagePersistence.scheduleSave('later note',edit);
          await mainStorageV2.commitPromise;
          if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
          const db=createStorageJournalDb(),owner=storageOwner.current(),mainKey=owner+':'+app,sharedKey=owner+':shared-checks';
          const before={main:JSON.stringify(await db.load(mainKey)),shared:JSON.stringify(await db.load(sharedKey))};
          approve(true);let outcome;try{outcome=await restoring}catch(error){outcome=error.code}
          if(outcome!==false&&outcome!=='backup_restore_scope_changed')throw Error('stale approval accepted');
          if(before.main!==JSON.stringify(await db.load(mainKey))||before.shared!==JSON.stringify(await db.load(sharedKey)))throw Error('stale restore changed native journals');
          const recovered=await mainStorageV2.recoverForOwner({intent:'load-account'});
          return {visible:state.notes.find(row=>row.id===note.id)?.content,recovered:recovered.state.notes.find(row=>row.id===note.id)?.content};
        })()""".replace('APP', json.dumps(app)), timeout=40)
        assert result == {'visible': 'exact edit during restore approval', 'recovered': 'exact edit during restore approval'}, result
        assert not browser.drain_serious_errors()
        print(f'PASS {app} stale restore approval retains exact later edit and unchanged native journals')
