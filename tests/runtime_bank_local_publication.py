"""Actual Kupa Bank composition: aborted local journal, status reads and retry.

Synthetic provider responses and an in-memory file handle; native IndexedDB.
No production bank credentials, remote writes or provider rescans on recovery.
"""
import argparse
import json
import subprocess
from pathlib import Path
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
 await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
 session.connectionMode='file';session.backendReady=true;
 const check=(ok,message)=>{if(!ok)throw Error(message)},phase=__PHASE__,stamp='2026-10-11T01:00:00.000Z';
 state.notes.push({id:'bank-local-note',content:'independent durable note',createdAt:stamp,updatedAt:stamp});
 state.bank={...state.bank,currentBalance:100,source:'manual',bankSyncAt:'2026-10-08T01:00:00.000Z'};
 await storagePersistence.saveState('fixture',{domains:['notes','bank'],operations:[{type:'put',collection:'notes',id:'bank-local-note',mode:'insert',index:state.notes.length-1,record:state.notes.at(-1)},{type:'set',field:'bank',value:state.bank}]});await mainStorageV2.commitPromise;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
 const fetch=globalThis.fetch,put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem,report=uiStatus.reportError,consoleError=console.error,errors=[];
 uiStatus.reportError=message=>errors.push(message);
 console.error=(...args)=>{errors.push(args.map(value=>value?.message||String(value)).join(' '));consoleError(...args)};
 let abort=true,scans=0,statusReads=0;
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','synthetic-pairing');localStorage.setItem('netunim_kupa_bank_auto_daily_v1','0');
 cloudTransport.saveFinancePatch=async()=>({saved:true});
 globalThis.fetch=(url,options)=>{
   if(String(url).includes('/balance')){scans++;return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'synthetic-account',transactions:[{id:'bank-local-tx',date:stamp,amount:12,description:'durable identity'}]}}})))}
   if(String(url).includes('/status')){statusReads++;return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:72,configured:true,lastScrapeAt:stamp})))}
   return fetch(url,options);
 };
 IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(abort&&this.name==='journal'){abort=false;const tx=this.transaction;queueMicrotask(()=>tx.abort())}return request};
 Storage.prototype.setItem=function(key,value){if(String(key).startsWith('netunim-storage-v2-emergency:'))throw new DOMException('controlled emergency quota','QuotaExceededError');return set.call(this,key,value)};
 try{
   uiNavigation.setPage('bank');check(await domainsBankController.refreshBankBalance()===false,'aborted local bank write reported success');
   const snapshotToken=state.bank.snapshotToken,bank=JSON.stringify(state.bank);
   check(state.bank.currentBalance===500,'unconfirmed projection was not retained');
   check(JSON.stringify(await db.load('local:kupa'))===mainBefore,'aborted bank write changed durable Main');
   IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set;
   await domainsBankController.refreshBankBridgeStatus();domainsBankView.renderBank();
   check(!document.getElementById('bankSyncHeadline').textContent.includes('הצליח'),'healthy Bridge status presented an unconfirmed bank write as success');
   check(document.querySelector('[data-bank-local-snapshot]')?.textContent.includes('לא אושר'),'unconfirmed bank projection warning missing outside settings');
   if(phase==='baseline')return true;
   uiNavigation.setPage('dashboard');check(document.querySelector('[data-bank-local-snapshot]')?.textContent.includes('לא אושר'),'dashboard uses unconfirmed balance without warning');
   uiNavigation.setPage('bank');check(await domainsBankController.refreshBankBalance()===false&&scans===1,'unconfirmed snapshot triggered another provider scan');
   const {payloadFromState}=await import('./assets/js/state/serialization.js');let file=JSON.stringify(payloadFromState({...((await mainStorageV2.recoverReadOnly()).state),checks:state.checks},session.dbRevision));
   files.dataFileHandle={name:'synthetic-kupa.json',getFile:async()=>({text:async()=>file}),createWritable:async()=>({write:async value=>{file=value},close:async()=>{}})};
   if(phase==='leadership'){tab.primaryTab=false;check(await domainsBankController.retryLocalBankSnapshot()===false,'secondary tab retried a bank mutation');tab.primaryTab=true}
   const retry=domainsBankController.retryLocalBankSnapshot;let first;
   domainsBankController.retryLocalBankSnapshot=(...args)=>{first=retry(...args);return first};
   try{document.querySelector('[data-action="retry-local-bank-snapshot"]').click()}finally{domainsBankController.retryLocalBankSnapshot=retry}
   check(first,'actual retry action did not reach the captured owner');const second=domainsBankController.retryLocalBankSnapshot();
   const a=await first,b=await second;check(a===true&&b===true,'local snapshot retry did not confirm existing data: '+JSON.stringify({a,b,errors}));
   check(scans===1,'snapshot retry rescanned the provider');check(state.bank.snapshotToken===snapshotToken&&JSON.stringify(state.bank)===bank,'retry changed the original bank snapshot');
   const recovered=await mainStorageV2.recoverReadOnly();check(recovered.state.bank.snapshotToken===snapshotToken&&recovered.state.bank.feed.transactions[0].id==='bank-local-tx','recovered snapshot lost transaction identity');
   check(recovered.state.notes.find(row=>row.id==='bank-local-note')?.content==='independent durable note','bank retry changed independent note');
   check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'bank retry changed Shared');
   domainsBankView.renderBank();check(!document.querySelector('[data-bank-local-snapshot]'),'confirmed snapshot still warned');
   return {sameSnapshot:true,sameTransaction:true,noteRetained:true,sharedRetained:true,scans,statusReads};
 }finally{globalThis.fetch=fetch;IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set;uiStatus.reportError=report;console.error=consoleError}
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--phase',choices=('retry','leadership'),action='append')
args=parser.parse_args()

class BankBrowser(BrowserSession):
    def _module_probe(self,payload):
        if args.baseline and payload.get('mode')=='instrument':
            for relative in ('domains/bank/controller.js','domains/bank/view.js'):
                name='netunim-kupa/site/assets/js/'+relative
                (Path(payload['site'])/'assets/js'/relative).write_bytes(subprocess.check_output(['git','show','d37d0caa75ca0da23145066840fbfc432943beff:'+name],cwd=ROOT))
        return super()._module_probe(payload)

for phase in ('baseline',) if args.baseline else args.phase or ('retry','leadership'):
    with BankBrowser(ROOT/'netunim-kupa/site','bank-local-'+phase) as browser:
        result=browser.evaluate(FLOW.replace('__PHASE__',json.dumps(phase)),timeout=45)
        if phase!='baseline':
            browser._navigate()
            restored=browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return {tx:recovered.state.bank.feed.transactions[0].id,note:recovered.state.notes.find(row=>row.id==='bank-local-note').content}})()""")
            assert restored=={'tx':'bank-local-tx','note':'independent durable note'},restored
            errors=browser.drain_serious_errors()
            assert all(error.startswith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture") for error in errors),errors
        print('PASS native Bank local snapshot '+phase+': '+json.dumps(result),flush=True)
