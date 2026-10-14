"""Both production Bank callers: native loopback decoding and exact Main/Shared IDB."""
import argparse
import json
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
 await appReady;
 const check=(ok,message)=>{if(!ok)throw Error(message)},site=__SITE__,caseName=__CASE__,kupa=site==='kupa',owner='bank-money-evidence-owner',stamp='2026-10-13T00:00:00.000Z';
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{syncDocument.stopPolling();finance.runtime.stop()}
 const note={id:'bank-money-evidence-note',content:'retained money boundary',createdAt:stamp,updatedAt:stamp};state.notes.push(note);
 const initialBank={...state.bank,currentBalance:100,source:'hapoalim',archiveInitialized:true,archiveVersion:2,bankSyncAt:stamp,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}};
 if(kupa)state.bank=initialBank;
 const mutation={domains:kupa?['notes','bank']:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note},...(kupa?[{type:'set',field:'bank',value:state.bank}]:[])]};
 if(kupa)await storagePersistence.saveState('money boundary',mutation);else storagePersistence.scheduleSave('money boundary',mutation);await mainStorageV2.commitPromise;
 const authenticate=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;authenticate({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,shared=null,remoteBank=initialBank,revision=1,scans=0,archives=0,commits=0,releases=0;
 const writeMain=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}},writeChecks=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 if(kupa){cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;syncDocument.rpcSaveCloudV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 else{cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;cloudTransport.rpcSaveV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});checksSession.kupaCloudReadState={bank:structuredClone(initialBank),creditSync:{profiles:[]}};checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1}
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 if(kupa){state.bank=structuredClone(initialBank);session.financeRevision=1;session.dbRevision=1}
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':'+site,sharedIdentity=owner+':shared-checks';
 const mainBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(sharedIdentity));
 const nonBank=value=>JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='bank')));
 const durableBefore=nonBank((await mainStorageV2.recoverReadOnly()).state);
 const readout=()=>({revision,financeRevision:revision,state:{...(kupa?structuredClone(main.state):{creditSync:{profiles:[]}}),bank:structuredClone(remoteBank)}});
 if(kupa)cloudTransport.readSupabaseDocument=async()=>readout();else cloudTransport.readKupaReadOnlyCloud=async()=>readout();
 cloudTransport.readFinanceSyncDocument=async()=>({revision,state:{bank:structuredClone(remoteBank),creditSync:{profiles:[]}}});
 cloudTransport.claimFinanceSyncLease=async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>{releases++;return true};
 checks.commands.sync=async()=>true;if(kupa)checks.queries.hasLocalWork=()=>false;else stateSnapshots.checksHaveLocalWork=()=>false;
 cloudTransport.syncBankTransactionsSnapshot=async()=>{archives++;return {sourcePayload:[],result:{total_count:0}}};cloudTransport.readBankTransactions=async()=>[];cloudTransport.readBankTransactionSnapshot=async()=>null;
 cloudTransport.saveBankSyncSnapshot=async candidate=>{commits++;remoteBank=structuredClone(candidate);revision=2;return {finance_revision:2,kupa_revision:2}};
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');localStorage.setItem('netunim_'+site+'_bank_auto_daily_v1','0');localStorage.setItem('netunim_'+site+'_credit_auto_daily_v1','0');
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>{
  const path=String(url);
  if(path.endsWith('/status')){if(caseName==='pairing')localStorage.setItem('netunim_kupa_bank_bridge_token_v1','replacement-pairing');return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:caseName==='old-runtime'?73:74,configured:true})))}
  if(path.includes('/balance')){scans++;return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:caseName==='invalid-business'?null:caseName==='blank'?' ':caseName==='zero'?0:500,accountId:'same-account',transactions:[],availableBalance:null,creditLimit:null,creditLimitUsed:null,creditLimitUsedPercent:null},home:caseName==='invalid-home'?{balance:null,accountId:'home-account',transactions:[]}:null}})))}
  if(path.includes('/rest/v1/order_management_documents?'))return Promise.resolve(new Response('[]'));
  if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
  return originalFetch(url,options);
 };
 try{
  const accepted=caseName==='zero'||caseName==='optional';
  const saved=await (kupa?bank.commands.refreshBankBalance():finance.commands.refreshBank());
  check(saved===accepted,'incorrect money evidence result '+caseName);
  check(commits===(accepted?1:0)&&archives===(accepted?1:0),'invalid money crossed the archive/publication boundary');
  check(scans===(caseName==='old-runtime'||caseName==='pairing'?0:1),'unexpected provider scan');check(releases===1,'own lease was not released');
  const result=kupa?state.bank:finance.queries.snapshot().bank;
  check(result.currentBalance===(accepted?(caseName==='zero'?0:500):100),'last good balance/known zero lost');
  if(accepted)for(const field of ['availableBalance','creditLimit','creditLimitUsed','creditLimitUsedPercent'])check(result[field]===null,'unknown '+field+' became zero');
  else check((kupa?bank.queries.snapshot().lastError:finance.queries.snapshot().bankError).length>0,'missing operator error');
  if(!accepted||!kupa)check(JSON.stringify(await db.load(identity))===mainBefore,'rejected Bank boundary changed Main journal');
  check(nonBank((await mainStorageV2.recoverReadOnly()).state)===durableBefore,'Bank publication changed independent durable data');
  const sharedAfter=JSON.stringify(await db.load(sharedIdentity));
  if(!accepted||!kupa)check(sharedAfter===sharedBefore,'rejected Bank boundary changed Shared journal');
  else{
    // An acknowledged Kupa refresh flushes the same Shared checkpoint with a
    // fresh savedAt/checksum. Its actual decoder must still verify the checksum.
    const sharedRecovered=await sharedChecksV2.recoverReadOnly();
    check(JSON.stringify(sharedRecovered.state)===JSON.stringify(JSON.parse(sharedBefore).checkpoints.data.state),'Bank changed Shared business data');
    const logical=row=>JSON.stringify({...row,checkpoints:{...row.checkpoints,data:{...row.checkpoints.data,savedAt:null},checksum:null}});
    check(logical(JSON.parse(sharedAfter))===logical(JSON.parse(sharedBefore)),'Bank changed Shared journal/base/control/identity beyond checkpoint time');
  }
  check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity lost');
  return {invalidPublicationBlocked:true,knownZeroRetained:true,unknownMoneyRetained:true,noDuplicateProvider:true,journalsRetained:true};
 }finally{globalThis.fetch=originalFetch;authenticate(null);if(kupa)financeAutomation.stop();else finance.runtime.stop()}
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--site',choices=('kupa','orders'),action='append')
parser.add_argument('--case',choices=('invalid-business','invalid-home','blank','zero','optional','old-runtime','pairing'),action='append')
args=parser.parse_args()
for site in args.site or ('kupa','orders'):
    for case in args.case or ('invalid-business','invalid-home','blank','zero','optional','old-runtime','pairing'):
        with BrowserSession(ROOT/f'netunim-{site}/site',f'bank-money-{site}-{case}') as browser:
            result=browser.evaluate(FLOW.replace('__SITE__',json.dumps(site)).replace('__CASE__',json.dumps(case)),timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored=browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='bank-money-evidence-note')?.content})()""")
            assert restored=='retained money boundary',restored
            errors=browser.drain_serious_errors()
            assert not errors,errors
            print('PASS native Bank money '+site+'/'+case+': '+json.dumps(result),flush=True)
