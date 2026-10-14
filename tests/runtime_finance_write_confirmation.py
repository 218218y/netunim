"""Real production Finance writers/HTTP decoders, native IDB and fresh recovery.

Only the server responses are simulated. No live provider/account is contacted.
An unknown response after a simulated commit must not publish success or retry.
"""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},site=__SITE__,kind=__KIND__,body=__BODY__,kupa=site==='kupa',owner='fixture-finance-receipt';
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{syncDocument.stopPolling();finance.runtime.stop()}
 const note={id:'finance-receipt-note',content:'durable before unknown Finance response'};state.notes.push(note);
 const operation={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
 if(kupa)await storagePersistence.saveState('Finance receipt fixture',operation);else storagePersistence.scheduleSave('Finance receipt fixture',operation);
 await mainStorageV2.commitPromise;
 const authenticate=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;authenticate({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,shared=null,commits=0,financeRevision=5,kupaRevision=5;
 const writeMain=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}},writeChecks=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 if(kupa){cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;syncDocument.rpcSaveCloudV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 else{cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;cloudTransport.rpcSaveV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 let remoteFinance={bank:{currentBalance:100},creditSync:{version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'stable-issuer-tx',date:'2026-10-11',chargedAmount:12}]}]}],cardMappings:{'P:card':{included:true,sortOrder:1}}}},remoteKupa={...structuredClone(main.state),bank:structuredClone(remoteFinance.bank),creditSync:structuredClone(remoteFinance.creditSync)};
 if(!kupa)Object.assign(remoteKupa,{credits:[],cash:[],rights:[],expenses:[],cards:[],notes:[note]});
 const readout=()=>({revision:kupaRevision,financeRevision,state:structuredClone({...remoteKupa,...remoteFinance})});
 cloudTransport.readFinanceSyncDocument=async()=>({revision:financeRevision,state:structuredClone(remoteFinance)});
 if(kupa){state.creditSync=structuredClone(remoteFinance.creditSync);session.financeRevision=5;session.dbRevision=kupaRevision;cloudTransport.readSupabaseDocument=async()=>readout()}
 else{checksSession.kupaCloudReadState=structuredClone(readout().state);checksSession.kupaReadRevision=5;checksSession.financeReadRevision=5;cloudTransport.readKupaReadOnlyCloud=async()=>readout()}
 const before=JSON.stringify(kupa?state.creditSync:checksSession.kupaCloudReadState);
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':'+site;
 const mainBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(owner+':shared-checks'));
 cloudTransport.claimFinanceSyncLease=async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>true;
 const request=async(path,options)=>{
   if(String(path).includes('/finance_sync_documents?'))return new Response(JSON.stringify([{revision:financeRevision,state:remoteFinance}]));
   if(String(path).endsWith('/claim_finance_sync_lease'))return new Response(JSON.stringify([{acquired:true,lease_token:JSON.parse(options.body).p_lease_token,fence_epoch:1,leased_until:'2030-01-01T00:00:00Z'}]));
   if(String(path).endsWith('/release_finance_sync_lease'))return new Response('true');
   options.assertRequestScope?.();check(String(path).endsWith(kind==='main'?'/save_kupa_document_v6':'/save_finance_sync_document_v6'),'unexpected fixture RPC '+path);
   const send=JSON.parse(options.body);check(send.p_expected_revision===5,'wrong captured base');commits++;
   if(kind==='main'){remoteKupa=structuredClone(send.p_state);kupaRevision=6}else{remoteFinance=structuredClone(send.p_state);financeRevision=6}
   return new Response(body);
 };
 if(kupa)cloudAuth.supaRest=request;else cloudAuth.supaFetch=request;
 let result,error;try{result=kind==='main'?await finance.commands.saveCashflowMinimum('business','321'):await (kupa?credit.commands:finance.commands).saveCreditCardOrder([])}catch(caught){error=caught;result=false}
 check(result===false,'malformed HTTP 200 was reported as a successful write');
 if(kind!=='main')check(error?.code==='FINANCE_WRITE_RECEIPT_INVALID'&&error.kind==='confirmation_unknown','missing explicit unknown confirmation '+JSON.stringify({commits,message:error?.message,code:error?.code}));
 check(JSON.stringify(kupa?state.creditSync:checksSession.kupaCloudReadState)===before,'unknown response replaced confirmed projection');
 check((kupa?session.financeRevision:checksSession.financeReadRevision)===5,'unknown response advanced Finance cursor');
 check(JSON.stringify(await db.load(identity))===mainBefore,'unknown Finance response changed Main journal');
 check(JSON.stringify(await db.load(owner+':shared-checks'))===sharedBefore,'unknown Finance response changed Shared journal');
 check(commits===1,'unexpected write count '+commits+'; result '+JSON.stringify({result,error:error?.message}));
 if(kupa)await syncDocument.cloudPoll();else await finance.queries.refreshFinanceData();
 const recovered=kupa?state:checksSession.kupaCloudReadState;
 if(kind==='main')check(recovered.cashflowSettings.businessMinimum===321,'read recovery lost committed settings');
 else {const {normalizeCreditSync}=await import(kupa?'./assets/js/domains/credit/sync-feed.js':'./assets/js/domains/finance/credit-feed.js');check(normalizeCreditSync(recovered.creditSync).profiles[0]?.accounts[0]?.txns[0]?.id==='stable-issuer-tx','read recovery lost issuer identity')}
 check(commits===1,'read recovery repeated remote operation');
 check((await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id===note.id)?.content===note.content,'durable note lost');
 authenticate(null);return {unknownReported:true,noPublication:true,cursorsRetained:true,journalsRetained:true,readRecovery:true,noDuplicateWrite:true,exactIds:true};
})()"""

failures = []
for site, kind in (('kupa', 'finance'), ('orders', 'finance'), ('orders', 'main')):
    for name, body in (('null', 'null'), ('invalid-json', '{broken')):
        if os.environ.get('NETUNIM_RECEIPT_CASE') not in (None, site + '-' + kind + '-' + name):
            continue
        try:
            with BrowserSession(ROOT / ('netunim-' + site + '/site'), 'finance-receipt-' + site + '-' + kind + '-' + name) as browser:
                result = browser.evaluate(FLOW.replace('__SITE__', json.dumps(site)).replace('__KIND__', json.dumps(kind)).replace('__BODY__', json.dumps(body)), timeout=45)
                assert result and all(result.values()), result
                browser._navigate()
                restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='finance-receipt-note')?.content})()""")
                assert restored == 'durable before unknown Finance response', restored
                assert not browser.drain_serious_errors()
                print('PASS Finance receipt ' + site + '/' + kind + '/' + name + ': ' + json.dumps(result), flush=True)
        except Exception as error:
            failures.append(site + '/' + kind + '/' + name + ': ' + str(error))
            print('FAIL ' + failures[-1], flush=True)
assert not failures, '\n'.join(failures)
