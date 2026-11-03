"""Kill an owned browser at a native Journal write callback, before a receipt."""
import json
import os
from pathlib import Path
import time

from acceptance_safety import write_evidence
from browser_harness import BrowserSession, ROOT
from crash_evidence import capture_stopped_indexeddb, snapshot_digest

SETUP = """(async()=>{
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
  const {sealStorageJsonRecord}=await import('./assets/js/shared/storage-json-codec.js');
  const {readStorageRecord}=await import('./assets/js/shared/storage-journal-model.js');
  window.labDb=createStorageJournalDb({name:'lab-mid-save'});
  window.labSeal=sealStorageJsonRecord;window.labRead=readStorageRecord;
  return true;
})()"""


def run(domain, directory):
    app = 'orders' if domain == 'shared-checks' else domain
    owner = 'synthetic-mid-save:'+domain
    collection = 'checks' if domain == 'shared-checks' else 'notes'
    with BrowserSession(ROOT/f'netunim-{app}/site', 'lab-mid-save-'+domain, instrument=False) as browser:
        assert browser.evaluate(SETUP)
        before = browser.evaluate("""(async()=>{
          window.labOwner=OWNER;const state={[COLLECTION]:[]};
          await labDb.install(labOwner,labSeal({version:2,owner:labOwner,epoch:'E',seq:0,state}),'W');
          await labDb.setBase(labOwner,'E','W',labSeal({version:2,owner:labOwner,epoch:'E',revision:1,ackSeq:0,state}));
          return labDb.load(labOwner);
        })()""".replace('OWNER', json.dumps(owner)).replace('COLLECTION', json.dumps(collection)))
        browser.call('Debugger.enable')
        # The pause is in the native request's success event. The production
        # transaction-complete receipt is still pending; no model ACK is injected.
        assert browser.evaluate("""(()=>{
          window.labReceipt=false;const original=IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put=function(...args){
            const request=original.apply(this,args);
            if(this.transaction.db.name==='lab-mid-save'&&this.name==='journal')
              request.addEventListener('success',()=>{debugger;},{once:true});
            return request;
          };
          window.labSaving=labDb.append(labOwner,'E','W',labSeal({version:2,owner:labOwner,epoch:'E',seq:1,
            generation:1,operationId:'lab-save-'+DOMAIN,at:'2026-11-03T00:00:00.000Z',
            changes:[{type:'put',collection:COLLECTION,id:'N',mode:'insert',index:0,record:{id:'N'}}]}))
            .then(()=>{labReceipt=true});
          return true;
        })()""".replace('DOMAIN', json.dumps(domain)).replace('COLLECTION', json.dumps(collection)))
        deadline = time.monotonic()+15
        paused = None
        while time.monotonic() < deadline and paused is None:
            browser.call('Debugger.setPauseOnExceptions', {'state': 'none'})
            paused = next((e['params'] for e in browser.events if e.get('method')=='Debugger.paused'), None)
        assert paused and paused['callFrames'], 'native journal callback was not intercepted'
        receipt = browser.call('Debugger.evaluateOnCallFrame', {
            'callFrameId': paused['callFrames'][0]['callFrameId'], 'expression': 'window.labReceipt', 'returnByValue': True})
        assert receipt['result']['result']['value'] is False
        stopped = {}
        def capture():
            stopped.update(capture_stopped_indexeddb(browser, directory/domain))
        process = browser.restart_process(crash=True, after_stop=capture)
        assert browser.evaluate(SETUP)
        after = browser.evaluate(f"labDb.load({json.dumps(owner)})")
        # Native commit may race process termination after the request callback.
        # Both whole-transaction outcomes are valid; partial metadata/Journal or
        # advanced cloud ACK is forbidden, and no pre-crash receipt was observed.
        assert after['metadata']['seq'] in (0, 1)
        assert len(after['journal']) == after['metadata']['seq']
        assert after['checkpoints'] == before['checkpoints'] and after['bases'] == before['bases']
        decoded = browser.evaluate(f"labDb.load({json.dumps(owner)}).then(s=>s.journal.map(labRead))")
        if decoded:
            assert decoded[0]['operationId'] == 'lab-save-'+domain and decoded[0]['seq'] == 1
        assert after['flights'] is None and after['controls'] is None
        stable_process = browser.restart_process()
        assert browser.evaluate(SETUP)
        assert browser.evaluate(f"labDb.load({json.dumps(owner)})") == after
        return {'scenario': domain+' process crash during local save', 'status': 'PASS',
                'operation_id': 'lab-save-'+domain, 'receipt_before_crash': False,
                'before': before, 'reopened': after, 'reopened_sha256': snapshot_digest(after),
                'stopped_indexeddb': stopped, 'process': process, 'stable_restart': stable_process,
                'cloud_revision': 1, 'ack_seq': 0}


if __name__ == '__main__':
    directory = Path(os.environ.get('NETUNIM_SUITE_REPORT_DIR', ROOT/'.work/acceptance/local-save-crash'))
    directory.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        for domain in ('orders', 'kupa', 'shared-checks'):
            results.append(run(domain, directory))
            write_evidence('local-save-crash', results)
    except Exception as error:
        write_evidence('local-save-crash', [*results, {'scenario': 'local save crash', 'status': 'UNRESOLVED',
                                                     'error_type': type(error).__name__}])
        raise
    print('PASS native local-save crash, atomic Journal and unchanged ACK across two restarts')
