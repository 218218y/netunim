"""Both actual import actions: native file/confirmation, pairing and exact IDB."""
import argparse
import json
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
 await appReady;
 const site=__SITE__,caseName=__CASE__,kupa=site==='kupa',cap=kupa?bank:finance,tokenKey='netunim_kupa_bank_bridge_token_v1';
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{finance.runtime.stop();syncDocument.stopPolling()}
 const check=(ok,message)=>{if(!ok)throw Error(message)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const note={id:'finance-import-owner-note',content:'retained import boundary'};state.notes.push(note);
 const mutation={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
 if(kupa)await storagePersistence.saveState('import boundary',mutation);else storagePersistence.scheduleSave('import boundary',mutation);await mainStorageV2.commitPromise;
 if(!kupa)storagePersistence.runtime.cancelPending();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const mainBefore=JSON.stringify(await db.load('local:'+site)),sharedBefore=JSON.stringify(await db.load('local:shared-checks')),modelBefore=JSON.stringify(state);
 localStorage.setItem(tokenKey,'pairing-A');
 const originalFetch=globalThis.fetch,originalConfirm=uiModal.confirmDialog,originalToast=uiStatus.toast,originalClick=HTMLInputElement.prototype.click,originalText=File.prototype.text;
 const entered=gate(),held=gate(),events=[],inputs=[];let imports=0,statuses=0,phase='accepted';
 const source={schema:'netunim-finance-connections',version:1,mode:'replace',bank:{provider:'hapoalim',userCode:'fixture',password:' padded bank password ',accounts:{business:{branchNumber:'0012',accountNumber:'0034'},home:{}}},credit:{profiles:[{provider:'max',connectionKey:'portable-fixture',label:'fixture',credentials:{username:'fixture',password:' padded credit password '}}]}};
 uiStatus.toast=message=>events.push(String(message));
 uiModal.confirmDialog=async()=>{if(['confirm','confirm-dispose'].includes(caseName)){entered.resolve();await held.promise}return true};
 File.prototype.text=async function(){if(caseName==='file-read'){entered.resolve();await held.promise}return originalText.call(this)};
 HTMLInputElement.prototype.click=function(){
  if(this.type!=='file')return originalClick.call(this);
  inputs.push(this);
  if(caseName==='picker-dispose'){entered.resolve();return}
  const files=new DataTransfer();files.items.add(new File([JSON.stringify(source)],'synthetic-import.json',{type:'application/json'}));this.files=files.files;this.dispatchEvent(new Event('change'));
 };
 globalThis.fetch=async(url,options)=>{
  const path=new URL(String(url)).pathname;
  check(String(options.headers.Authorization).includes('pairing-A')||phase==='replacement','unexpected request authority');
  if(path==='/status'){
   statuses++;
   if(['status','status-dispose'].includes(caseName)&&phase==='accepted'){entered.resolve();await held.promise}
   if(caseName==='publish'&&statuses>1){entered.resolve();await held.promise}
   return new Response(JSON.stringify({bridgeVersion:74,configured:true,businessBranchNumber:'0012',businessAccountNumber:'0034'}));
  }
  if(path==='/v2/credit/status'||path==='/credit/status')return new Response(JSON.stringify({bridgeVersion:74,contractVersion:2,profiles:[]}));
  if(path==='/settings/import'){
   imports++;const value=JSON.parse(options.body);check(value.bank.password===source.bank.password&&value.credit.profiles[0].credentials.password===source.credit.profiles[0].credentials.password,'password whitespace changed');check(value.credit.profiles[0].connectionKey==='portable-fixture'&&!value.credit.profiles[0].profileId,'portable identity changed');
   if(['response','response-error','response-dispose'].includes(caseName)){entered.resolve();await held.promise}
   if(caseName==='response-error')return new Response(JSON.stringify({ok:false,message:'private former-device import error'}),{status:400});
   return new Response(JSON.stringify({ok:true,cleanupWarnings:[]}));
  }
  throw Error('unexpected import request '+path);
 };
 try{
  uiActions[kupa?'import-finance-connections':'import-orders-finance-connections']({dataset:{}},{preventDefault(){},stopPropagation(){}});
  await entered.promise;
  check(cap.runtime.isPending(),'import absent from parent pending state');
  if(caseName.endsWith('dispose'))check(cap.runtime.dispose()===true&&cap.runtime.dispose()===false,'parent disposal is not idempotent');
  else{localStorage.setItem(tokenKey,'pairing-B');phase='replacement'}
  let drained=false;const drain=cap.runtime.drain().then(()=>{drained=true});await Promise.resolve();
  if(caseName!=='picker-dispose')check(!drained,'parent drain abandoned an accepted request/file/confirmation');
  held.resolve();await drain;
  check(!cap.runtime.isPending(),'import did not settle');check(inputs.every(node=>!node.isConnected),'hidden file input leaked');
  check(imports===(['response','response-error','response-dispose','publish'].includes(caseName)?1:0),'former-device selection/confirmation wrote replacement credentials');
  check(events.length===0,'former-device import published success/error');
  check(JSON.stringify(state)===modelBefore,'local import changed business state');check(JSON.stringify(await db.load('local:'+site))===mainBefore,'local import changed Main journal');check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'local import changed Shared journal');
  return {deviceBound:true,acceptedWorkDrained:true,nativeInputReleased:true,noForeignPublication:true,journalsRetained:true};
 }finally{held.resolve();globalThis.fetch=originalFetch;uiModal.confirmDialog=originalConfirm;uiStatus.toast=originalToast;HTMLInputElement.prototype.click=originalClick;File.prototype.text=originalText;if(kupa)financeAutomation.stop();else finance.runtime.stop()}
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--site',choices=('kupa','orders'),action='append')
parser.add_argument('--case',choices=('status','file-read','confirm','response','response-error','publish','status-dispose','picker-dispose','confirm-dispose','response-dispose'),action='append')
args=parser.parse_args()
for site in args.site or ('kupa','orders'):
    for case in args.case or ('status','file-read','confirm','response','response-error','publish',
                              'status-dispose','picker-dispose','confirm-dispose','response-dispose'):
        with BrowserSession(ROOT/f'netunim-{site}/site',f'finance-import-{site}-{case}') as browser:
            result=browser.evaluate(FLOW.replace('__SITE__',json.dumps(site)).replace('__CASE__',json.dumps(case)),timeout=40)
            assert result and all(result.values()),result
            browser._navigate()
            restored=browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='finance-import-owner-note')?.content})()""")
            assert restored=='retained import boundary',restored
            errors=browser.drain_serious_errors()
            assert not errors,errors
            print('PASS native Finance import '+site+'/'+case+': '+json.dumps(result),flush=True)
