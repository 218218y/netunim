"""Unmodified pre-bundle modules -> compiled application -> historical rollback."""
from functools import partial
import json
from pathlib import Path
import shutil
import tempfile
from urllib.parse import urlparse
from browser_harness import BrowserSession, ROOT, _QuietHandler
from prebundle_fixture import restore_prebundle
from pwa_upgrade import wait_for_worker_control, wait_for_waiting_upgrade
from production_runtime_scenarios import documents

SEED = r"""(async()=>{
  const app=APP,count=1000,{createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
  const {STORAGE_SCHEMAS,SHARED_CHECKS_STORAGE_SCHEMA}=await import('./assets/js/shared/storage-v2-schema.js');
  const journal=createStorageJournal({owner:'local:'+app,schema:STORAGE_SCHEMAS[app],validate:()=>{}});
  await journal.open();const current=await journal.recover(),state=current.state;
  if(app==='orders'){
    state.suppliers=[{id:'migration-supplier',name:'Migration supplier',active:true}];
    state.transactions=Array.from({length:count},(_,i)=>({id:'M'+i,supplierId:'migration-supplier',sequence:i+1,action:'Migration transaction '+i,debit:i%200,credit:0}));
  }else state.cash=Array.from({length:count},(_,i)=>({id:'M'+i,date:'2026-10-01',description:'Migration cash '+i,amount:i%200}));
  await journal.install(state,{expectedEpoch:journal.epoch,appMetadata:current.appMetadata});
  const shared=createStorageJournal({owner:'local:shared-checks',schema:SHARED_CHECKS_STORAGE_SCHEMA,validate:()=>{}});
  await shared.open();const head=await shared.recover();head.state.checks=Array.from({length:100},(_,i)=>({id:'SH'+i,amount:i+1,status:'open',date:'2026-10-01',payee:'Migration payee '+i}));
  await shared.install(head.state,{expectedEpoch:shared.epoch,appMetadata:head.appMetadata});
  localStorage.setItem('prebundle-migration-sentinel','preserved');
  return {rows:count,shared:100};
})()"""

INTERRUPT = r"""(async()=>{
  const app=APP,{createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
  const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
  const db=createStorageJournalDb(),failed={...db,append:async()=>{throw Error('isolated interrupted write')}};
  const journal=createStorageJournal({owner:'local:'+app,schema:STORAGE_SCHEMAS[app],validate:()=>{},db:failed});
  await journal.open();const head=await journal.recover(),collection=app==='orders'?'transactions':'cash';
  const record={...head.state[collection][0],[app==='orders'?'action':'description']:'Migration interrupted write'};
  const pending=journal.append([{type:'put',collection,mode:'replace',id:record.id,record}],{appMetadata:head.appMetadata});
  let rejected=false;try{await pending.committed}catch{rejected=true}
  if(!pending.emergencyDurable||!rejected)throw Error('interruption fixture was not durable only in emergency storage');
  return record;
})()"""

READ = r"""(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('netunim-storage-v2');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const read=store=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const checkpoints=await read('checkpoints'),journal=await read('journal');db.close();
  const owners=['local:'+APP,'local:shared-checks'],result={};
  for(const owner of owners){
    const checkpoint=checkpoints.find(row=>row.data.owner===owner)?.data;
    if(!checkpoint)throw Error('migration checkpoint missing '+owner);
    let state=structuredClone(checkpoint.state);
    for(const operation of journal.map(row=>row.data).filter(row=>row.owner===owner&&row.epoch===checkpoint.epoch&&row.seq>checkpoint.seq).sort((a,b)=>a.seq-b.seq)){
      for(const change of operation.changes){
        if(change.type==='replace-state')state=structuredClone(change.state);
        else if(change.type==='set')state[change.field]=change.value;
        else{const rows=state[change.collection],index=rows.findIndex(row=>row.id===change.id);
          if(change.type==='delete'){if(index>=0)rows.splice(index,1)}
          else if(change.mode==='insert')rows.splice(change.index,0,change.record);
          else if(index>=0)rows[index]=change.record;
        }
      }
    }
    result[owner]={version:checkpoint.version,state};
  }
  return {owners:result,preference:localStorage.getItem('prebundle-migration-sentinel')};
})()"""


def prebundle_upgrade(app, ready):
    with tempfile.TemporaryDirectory(prefix='netunim-prebundle-source-') as directory:
        legacy = Path(directory)/'site'
        metadata = restore_prebundle(app, legacy)
        with BrowserSession(legacy, app+'-prebundle-migration', instrument=False, service_worker=True, auto_navigate=False) as browser:
            site = browser.tmp/'site'
            published = {'site': site}
            class FreshWorker(_QuietHandler):
                def do_GET(self):
                    self.directory = str(published['site'])
                    if urlparse(self.path).path == '/service-worker.js' and 'If-Modified-Since' in self.headers:
                        del self.headers['If-Modified-Since']
                    super().do_GET()
            browser.httpd.RequestHandlerClass = partial(FreshWorker, directory=str(site))
            browser._navigate();ready(browser);wait_for_worker_control(browser)
            assert browser.evaluate("fetch('./index.html').then(row=>row.headers.get('X-Netunim-Release'))") == metadata['releases'][app]
            assert browser.evaluate(SEED.replace('APP', json.dumps(app)), timeout=30) == {'rows': 1000, 'shared': 100}
            browser._navigate();ready(browser)
            before = browser.evaluate(READ.replace('APP', json.dumps(app)))
            isolated = (site/'supabase/config.js').read_bytes()
            target = browser.call('Target.createTarget', {'url': browser.url})['result']['targetId']
            interrupted_record = browser.evaluate(INTERRUPT.replace('APP', json.dumps(app)))
            after_recovery = json.loads(json.dumps(before))
            collection = 'transactions' if app == 'orders' else 'cash'
            after_recovery['owners']['local:'+app]['state'][collection][0] = interrupted_record
            future = browser.tmp/'bundled-site'
            shutil.copytree(ROOT/'dist'/app, future)
            (future/'supabase/config.js').write_bytes(isolated)
            # Model a provider deployment pointer, not deleting files still
            # being streamed to a second browser window on Windows.
            published['site'] = future
            wait_for_waiting_upgrade(browser)
            old_feature = browser.evaluate("import('./assets/js/domains/documents/text-search-viewer.js').then(module=>typeof module.createTextSearchViewer)")
            assert old_feature == 'function'
            # The old durable head still lacks the deliberately interrupted edit.
            assert browser.evaluate(READ.replace('APP', json.dumps(app))) == before
            browser.call('Target.closeTarget', {'targetId': target})
            # The operational first-migration boundary: close all old clients.
            # No code in a newly deployed worker can retrofit historical workers.
            browser.restart_process();ready(browser);wait_for_worker_control(browser)
            assert browser.evaluate(READ.replace('APP', json.dumps(app))) == after_recovery
            documents(browser, app)
            assert not (future/'assets/js/main.js').exists(), 'Test accidentally retained source deployment paths'
            published['site'] = site
            wait_for_waiting_upgrade(browser)
            browser.restart_process();ready(browser);wait_for_worker_control(browser)
            assert browser.evaluate(READ.replace('APP', json.dumps(app))) == after_recovery
            assert not browser.drain_serious_errors()
            return {'historicalCommit': metadata['sourceCommit'], 'deployedIdentityVerified': False,
                    'mainRows': 1000, 'sharedChecks': 100, 'oldCachedFeatureAfterReplacement': True,
                    'maintenanceCloseAllTabsUpgrade': True, 'unmodifiedHistoricalRollback': True,
                    'mainAndSharedDataPreserved': True, 'interruptedHistoricalWriteRecovered': True}
