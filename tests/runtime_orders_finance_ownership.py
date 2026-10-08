"""Production Orders Finance/auth/readout, real Main+Shared IDB and fresh-runtime recovery."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const kind=__KIND__,caseName=__CASE__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stamp='2026-10-08T10:00:00.000Z',originalFetch=globalThis.fetch;
 syncDocument.stopPolling();domainsFinanceController.stopAutoSync?.();
 const note={id:'orders-finance-note',content:'durable before finance request'};state.notes.push(note);
 storagePersistence.scheduleSave('finance ownership fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
 cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
 cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':orders';
 const beforeMain=JSON.stringify(await db.load(identity));
 let financeRevision=1,kupaReadRevision=1,finance={bank:{source:'hapoalim',currentBalance:100,bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}},creditSync:{version:3,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]}};
 checksSession.kupaCloudReadState=structuredClone(finance);checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1;
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
 localStorage.setItem('netunim_orders_bank_auto_daily_v1','0');localStorage.setItem('netunim_orders_credit_auto_daily_v1','0');
 const entered=deferred(),provider=deferred(),saving=deferred(),saved=deferred();let publications=0,archives=0,releases=0;
 cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:kind.toLowerCase(),leaseToken:'fixture',fenceEpoch:1});
 cloudTransport.releaseFinanceSyncLease=async(_kind,_token,options)=>{options?.assertCurrent?.();releases++;return true};
 cloudTransport.readKupaReadOnlyCloud=async()=>({revision:kupaReadRevision,financeRevision,state:structuredClone(finance)});
 cloudTransport.readFinanceSyncDocument=async()=>({revision:financeRevision,state:structuredClone(finance)});
 syncChecks.syncSharedChecksFromCloud=async()=>true;stateSnapshots.checksHaveLocalWork=()=>false;
 cloudTransport.syncBankTransactionsSnapshot=async()=>{archives++;return {sourcePayload:[],result:{total_count:0}}};
 cloudTransport.readBankTransactions=async()=>kind==='Bank'&&['network','lost-response'].includes(caseName)?[{id:'uncommitted',date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:'uncommitted'}]:[];cloudTransport.readBankTransactionSnapshot=async()=>null;
 const publish=async next=>{publications++;if(caseName==='publication'){saving.resolve();await saved.promise}if(caseName==='network')throw Error('fixture Finance request failed');finance=next;financeRevision=2;if(kind==='Bank')kupaReadRevision=2;if(caseName==='lost-response')throw Error('fixture committed Finance response lost');return {revision:2,finance_revision:financeRevision,kupa_revision:kupaReadRevision,state:next}};
 cloudTransport.saveBankSyncSnapshot=async bank=>publish({...finance,bank});cloudTransport.rpcSaveFinanceSync=async next=>({r:{ok:true},row:await publish(next)});
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
   if(path.includes('/balance')||path.includes('/v2/credit/sync')){entered.resolve();return provider.promise}
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return originalFetch(url,options);
 };
 const before=JSON.stringify(checksSession.kupaCloudReadState),pending=domainsFinanceController['refresh'+kind]();await entered.promise;
 if(caseName==='logout')check(uiCloud.logoutCloud()===true,'production logout rejected');
 if(caseName==='account')cloudAuth.saveSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'other',expires_at:9999999999});
 if(caseName==='relogin'){cloudAuth.saveSession(null);cloudAuth.saveSession({user:{id:owner},access_token:'fixture-2',expires_at:9999999999})}
 if(caseName==='secondary')tab.primaryTab=false;
 const result=kind==='Bank'?{ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}}:{ok:true,syncedAt:stamp,attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'issuer-tx',date:stamp,chargedAmount:-12}]}]}],errors:[]};provider.resolve(new Response(JSON.stringify(result)));
 if(caseName==='publication'){await saving.promise;cloudAuth.saveSession(null);saved.resolve()}
 check(await pending===false,'former/failed Finance operation reported success');
 check(JSON.stringify(checksSession.kupaCloudReadState)===before,'former/failed Finance result replaced readout');
 check(domainsFinanceController.snapshot().bank.feed.transactions.length===0,'uncommitted archive replaced display');
 check(publications===(['publication','network','lost-response'].includes(caseName)?1:0),'unexpected Finance write');
 check(archives===(kind==='Bank'&&['publication','network','lost-response'].includes(caseName)?1:0),'former result entered Bank archive transport');
 check(JSON.stringify(await db.load(identity))===beforeMain,'Finance failure changed Main durable journal');
 check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content lost');
 check(domainsFinanceController.snapshot()[kind.toLowerCase()+'Error'].length>0,'missing operator failure');
 check(['network','lost-response'].includes(caseName)||releases===0,'former scope released lease under replacement authorization');
 if(caseName==='lost-response'){
   await domainsFinanceController.refreshFinanceData();const recovered=domainsFinanceController.snapshot();
   if(kind==='Bank'){check(recovered.bank.currentBalance===500,'committed Bank balance not recoverable');check(JSON.stringify(recovered.bank.feed.transactions.map(row=>row.id))==='["uncommitted"]','Bank record identity duplicated or lost')}
   else check(JSON.stringify(recovered.creditSync.profiles[0].accounts[0].txns.map(row=>row.id))==='["issuer-tx"]','Credit record identity duplicated or lost');
   check(publications===1,'recovery replayed a provider commit');check(JSON.stringify(await db.load(identity))===beforeMain,'readout recovery changed Main journal');
 }
 globalThis.fetch=originalFetch;domainsFinanceController.stopAutoSync?.();cloudAuth.saveSession(null);
 return {projectionRetained:true,archiveRetained:true,journalRetained:true,noteRetained:true,scopedPublication:true,visibleError:true};
})()"""

for kind in ('Bank', 'Credit'):
    for case in ('logout', 'account', 'relogin', 'secondary', 'publication', 'network', 'lost-response'):
        with BrowserSession(ROOT / 'netunim-orders/site', 'orders-finance-' + kind.lower() + '-' + case) as browser:
            result = browser.evaluate(FLOW.replace('__KIND__', json.dumps(kind)).replace('__CASE__', json.dumps(case)), timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='orders-finance-note')?.content})()""")
            assert restored == 'durable before finance request', restored
            assert not browser.drain_serious_errors()
            print('PASS Orders ' + kind + ' ownership ' + case + ': ' + json.dumps(result))
