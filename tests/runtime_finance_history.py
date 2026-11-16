"""Actual lazy history dialog, actions, UTF-8 download and guarded restore in both sites."""
import base64
from browser_harness import BrowserSession, ROOT
FLOW=r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},app=__APP__,kupa=app==='kupa',owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const wait=async(test)=>{for(let i=0;i<300;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('History UI did not settle: '+document.querySelector('[data-finance-history]')?.textContent)};
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{finance.runtime.stop();syncDocument.stopPolling()}
 let main=null,shared=null;
 if(kupa){
  cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
  cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;
  syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
  cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
  await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
  session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 }else{
  cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
  cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
  cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
  cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
  await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
 }
 const tx={id:'restored',date:'2026-10-01',processedDate:'2026-10-10',status:'completed',chargedAmount:-365,chargedCurrency:'ILS',originalAmount:-365,originalCurrency:'ILS',description:'עסקה לבדיקה'};
 const target={bank:{currentBalance:100},creditSync:{version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'1234',months:[{month:'2026-10',transactions:[tx]}],unassignedTransactions:[]}]}],cardMappings:{'P:1234':{included:false,account:'עסקי'}}}};
 let live={revision:5,state:{bank:{currentBalance:900,source:'manual',adjustments:[]},creditSync:structuredClone(target.creditSync)}},writes=0,download=null;
 live.state.creditSync.cardMappings['P:1234'].included=true;
 const {sha256,readFinanceBackup}=await import('./assets/js/shared/finance-history-model.js'),wire=JSON.stringify(target),hash=await sha256(wire);
 const request=async(path,options)=>{
  const args=JSON.parse(options.body);options.assertRequestScope?.();
  if(path.endsWith('list_finance_document_versions'))return Response.json([{revision:2,captured_at:'2026-11-14T10:00:00Z',state_hash:hash,reason:'fixture'}]);
  if(path.endsWith('export_finance_document_version'))return Response.json([{revision:2,state_text:wire,state_hash:hash}]);
  if(path.endsWith('restore_finance_credit_version')){writes++;check(args.p_expected_revision===5&&args.p_version===2,'wrong restoration head');live={revision:6,state:{...live.state,creditSync:target.creditSync}};return Response.json([{...live,operation_revision:6,operation_replayed:false}])}
  throw Error('Unexpected History RPC: '+path);
 };
 if(kupa)cloudAuth.supaRest=request;else cloudAuth.supaFetch=request;
 cloudTransport.readFinanceSyncDocument=async options=>{options?.assertCurrent?.();return structuredClone(live)};
 cloudTransport.claimFinanceSyncLease=async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>true;
 if(kupa){
  cloudTransport.readSupabaseDocument=async()=>({revision:main.revision,financeRevision:live.revision,state:{...structuredClone(main.state),...structuredClone(live.state)}});
  session.financeRevision=5;state.creditSync=live.state.creditSync;document.getElementById('connectScreen').style.display='none';ui.currentPage='credit';ui.expensesTab='credit';ui.creditSyncOpen=true;credit.renderCredit();
 }else{
  cloudTransport.readKupaReadOnlyCloud=async()=>({revision:1,financeRevision:live.revision,state:structuredClone(live.state)});
  cloudTransport.readKupaReadOnlyMeta=async()=>({revision:1,financeRevision:live.revision});
  checksSession.kupaCloudReadState=structuredClone(live.state);checksSession.kupaReadRevision=1;checksSession.financeReadRevision=5;ui.currentView='kupa';ui.kupaSubView='credit';ui.creditSyncOpen=true;finance.presentation.renderKupa();
 }
 document.querySelector('[data-action="'+(kupa?'credit-finance-history':'orders-credit-finance-history')+'"]').click();
 await wait(()=>document.querySelector('[data-history-version]'));
 const select=document.querySelector('[data-history-version]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('[data-history-export]'));
 check(document.querySelector('[data-history-preview]').textContent.includes('2026-10'),'missing month comparison');
 check(document.querySelector('[data-history-preview]').textContent.includes('הכללה בחישוב'),'missing mapping comparison');
 check(document.querySelector('[data-history-preview]').textContent.includes('365.00'),'365 to zero calculated impact is invisible');
 const nativeCreate=URL.createObjectURL,nativeClick=HTMLAnchorElement.prototype.click;
 URL.createObjectURL=blob=>{download=blob;return nativeCreate.call(URL,blob)};HTMLAnchorElement.prototype.click=function(){};
 try{document.querySelector('[data-history-export]').click();await wait(()=>download);check((await readFinanceBackup(JSON.parse(await download.text()))).creditSync.profiles.length===1,'download failed integrity check')}
 finally{URL.createObjectURL=nativeCreate;HTMLAnchorElement.prototype.click=nativeClick}
 await wait(()=>!document.querySelector('[data-history-restore]').disabled);
 document.querySelector('[data-history-restore]').click();check(writes===0,'unreviewed restore wrote Finance');
 document.querySelector('[data-history-reason]').value='בדיקת שחזור מאומתת';document.querySelector('[data-history-reviewed]').checked=true;
 const root=document.querySelector('[data-finance-history]');check(root.scrollWidth<=root.clientWidth+1,'history panel overflows modal');
 window.finishHistoryFixture=async()=>{
  document.querySelector('[data-history-restore]').click();
  await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'));check(writes===0,'write before central confirmation');
  document.getElementById('confirmCancel').click();await wait(()=>!document.querySelector('[data-history-restore]').disabled);check(writes===0,'cancelled restore wrote Finance');
  document.querySelector('[data-history-restore]').click();await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
  document.getElementById('confirmAccept').click();await wait(()=>writes===1&&document.querySelector('[data-finance-history]').textContent.includes('נשמר'));
  check(live.state.bank.currentBalance===900,'Bank rewound during Credit restoration');check(writes===1,'restore duplicated');return true;
 };
 return true;
})()"""
for app in ('kupa','orders'):
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-finance-history') as browser:
        browser.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':900,'deviceScaleFactor':1,'mobile':False})
        assert browser.evaluate(FLOW.replace('__APP__',repr(app)),timeout=60)
        image=ROOT/'.work/screenshots'/f'{app}-finance-history.png';image.parent.mkdir(parents=True,exist_ok=True)
        image.write_bytes(base64.b64decode(browser.call('Page.captureScreenshot',{'format':'png'})['result']['data']))
        assert browser.evaluate('finishHistoryFixture()',timeout=60)
        assert not browser.drain_serious_errors()
        print('PASS',app,'actual lazy history actions, comparison, verified download, explicit restore and current Bank')
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-invalid-finance-history') as browser:
        prefix=FLOW[:FLOW.index(' const nativeCreate=')]
        prefix=prefix.replace(' let live='," target.creditSync.profiles.push(structuredClone(target.creditSync.profiles[0]));\n let live=",1)
        invalid=prefix+"""
 await wait(()=>document.querySelector('[data-history-restore]')?.disabled);
 check(document.querySelector('[data-history-preview]').textContent.includes('אינה תקינה'),'invalid archive lacks explanation');
 check(!document.querySelector('[data-history-export]').disabled,'invalid archive cannot be exported');
 document.querySelector('[data-history-restore]').click();check(writes===0,'invalid archive restored');
 return true;
})()"""
        assert browser.evaluate(invalid.replace('__APP__',repr(app)),timeout=60)
        assert not browser.drain_serious_errors()
        print('PASS',app,'invalid retained version remains exportable and ordinary restore stays disabled')
