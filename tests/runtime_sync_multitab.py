import json

from browser_harness import BrowserSession, ROOT


site = ROOT / "netunim-orders/site"
passed = False
try:
    with BrowserSession(site, "orders-sync-multitab") as browser:
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        browser.evaluate("""(()=>{
          localStorage.setItem('orders.google-calendar.connection.v1',JSON.stringify({known:true,autoConnect:true,accountId:'remembered@example.com'}));
          localStorage.setItem('orders.supabase.session.v1',JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600}));
          return true;
        })()""")
        with browser.second_tab():
            result = browser.evaluate("""(async()=>{
              await new Promise(resolve=>setTimeout(resolve,250));
              return {
                secondaryGuard:document.querySelector('#tabWriterGuard')?.hidden===false,
                calendarBackendRequests:performance.getEntriesByType('resource').filter(entry=>String(entry.name).includes('/functions/v1/google-calendar-oauth')).length,
                dataApiRequests:performance.getEntriesByType('resource').filter(entry=>String(entry.name).includes('/rest/v1/')).length,
              };
            })()""")
            print("orders-secondary", json.dumps(result, ensure_ascii=False))
            passed = result == {"secondaryGuard": True, "calendarBackendRequests": 0, "dataApiRequests": 0}
        assert passed, result
        before = browser.evaluate(r"""(async()=>{
          const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
          finance.runtime.stop();syncDocument.stopPolling();
          cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
          let main=null,shared=null;
          cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
          cloudTransport.rpcSaveV2=async state=>{main={revision:1,state};return {r:{ok:true},row:main}};
          cloudTransport.rpcSaveSharedChecksV2=async checks=>{
            shared={revision:1,state:{version:1,checks,bankEvents:[]}};return {r:{ok:true},row:shared};
          };
          await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const db=createStorageJournalDb();
          return JSON.stringify(await Promise.all([db.load(owner+':orders'),db.load(owner+':shared-checks')]));
        })()""")
        read_fixture = r"""(()=>{
          const today=new Date().toISOString(),requests=globalThis.secondaryFinanceRequests=[];
          const readRpcs={
            '/rest/v1/rpc/get_netunim_sync_capabilities':{
              documentOperationLedger:3,syncIntegrity:5,deleteIntents:4,massDeleteGuard:5,restoreGroups:5,
              sharedChecksIntegrity:5,financeFencing:2,storageWriterProtocol:2,
            },
            '/rest/v1/rpc/list_bank_morning_document_links':[],
          };
          const backends={
            '/rest/v1/kupa_documents':[{document_name:'main',revision:2,updated_at:today,state:{bank:{adjustments:[]}}}],
            '/rest/v1/finance_sync_documents':[{document_name:'main',revision:3,updated_at:today,state:{
              bank:{source:'hapoalim',currentBalance:98765,bankSyncAt:today,feed:{accountNumber:'fixture-bank',syncedAt:today,balance:98765,transactions:[]}},
              creditSync:{
                version:3,syncedAt:today,cardMappings:{'fixture-profile:9876':{included:true}},
                profiles:[{profileId:'fixture-profile',provider:'max',accounts:[{
                  accountNumber:'9876',txns:[{id:'fixture-card-row',date:today,processedDate:today,description:'ReadOnlyCardMovement',chargedAmount:-135,status:'completed'}]
                }]}],errors:[]
              }
            }}],
            '/rest/v1/bank_transaction_snapshots':[],
            '/rest/v1/bank_transactions':[{
              id:1,account_key:'fixture-bank',account_role:'business',merge_key:'fixture-bank-row',transaction_date:today,
              processed_date:null,amount:250,currency:'ILS',description:'ReadOnlyBankMovement',status:'completed',presence_state:'present',
              first_seen_at:today,last_seen_at:today,missing_since:null,missing_acknowledged_at:null,
              alert_acknowledgements:{},cheque:false,balance_after:null
            }],
          };
          const fetchNative=globalThis.fetch;
          globalThis.fetch=(url,options)=>{
            const target=new URL(String(url),location.href);
            if(target.origin===location.origin)return fetchNative(url,options);
            const method=options?.method||'GET';requests.push([method,target.pathname]);
            const response=method==='GET'?backends[target.pathname]:method==='POST'?readRpcs[target.pathname]:undefined;
            if(response===undefined)throw Error('Unexpected secondary request: '+method+' '+target.pathname);
            return Promise.resolve(new Response(JSON.stringify(response),{status:200}));
          };
        })()"""
        with browser.second_tab(setup_script=read_fixture):
            result = browser.evaluate(r"""(async()=>{
              const check=(ok,message)=>{if(!ok)throw Error(message)};
              check(!tab.primaryTab&&tab.readOnlyTab,'The secondary tab must stay read-only');
              check(await session.startupHydrationPromise,'Read-only Finance hydration failed');
              switchView('kupa');
              const section=name=>document.querySelector(`[data-action="set-kupa-section"][data-click-arg0="${name}"]`).click();
              section('bank');
              await finance.runtime.drain();
              const financeData=finance.queries.snapshot();
              check(financeData.bank.feed.transactions.some(row=>row.description==='ReadOnlyBankMovement'),'Bank archive not available in the secondary tab');
              check(document.getElementById('main').textContent.includes('ReadOnlyBankMovement'),'Bank movement not visible');
              section('credit');
              check(financeData.creditSync.profiles[0].accounts[0].txns[0].id==='fixture-card-row','Last credit synchronization not available');
              document.querySelector('[data-action="orders-credit-detail-period"][data-click-arg0="all"]').click();
              check(document.getElementById('main').textContent.includes('ReadOnlyCardMovement'),'Card movement not visible');
              const readOnlyRpcs=['/rest/v1/rpc/get_netunim_sync_capabilities','/rest/v1/rpc/list_bank_morning_document_links'];
              check(globalThis.secondaryFinanceRequests.every(([method,path])=>method==='GET'||readOnlyRpcs.includes(path)),'Secondary Finance attempted a write');
              const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
              const db=createStorageJournalDb(),owner=cloudAuth.loadSession().user.id;
              return JSON.stringify(await Promise.all([db.load(owner+':orders'),db.load(owner+':shared-checks')]));
            })()""", timeout=20)
            assert result == before, 'Read-only Finance hydration changed a journal'
            assert not browser.drain_serious_errors()
        print("PASS Orders secondary tab displays the last bank archive and credit synchronization without writes")
except Exception as exc:
    print("orders-sync-multitab FAIL", exc)
    passed = False

raise SystemExit(0 if passed else 1)
