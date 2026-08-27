import json

from browser_harness import BrowserSession, ROOT


def run(label, site, expression, expected):
    try:
        with BrowserSession(site, label + "-sync") as browser:
            value = browser.evaluate(expression)
            print(label, json.dumps(value, ensure_ascii=False))
            if value != expected:
                print("EXPECTED", json.dumps(expected, ensure_ascii=False))
                return False
            errors = browser.drain_serious_errors()
            if errors:
                print("UNEXPECTED ERRORS", json.dumps(errors, ensure_ascii=False))
                return False
            return True
    except Exception as exc:
        print(label, "FAIL", exc)
        return False


kupa_expr = r"""(async()=>{
 const sample=normalizeState({version:4,businessName:'בדיקה',bank:{currentBalance:1000,updatedAt:'2026-08-27T10:00:00Z',asOfDate:'2026-08-27',snapshotSeq:5,snapshotToken:'S',adjustments:[]},checks:[],credits:[],cash:[{id:'CA1',amount:10}],expenses:[{id:'E1',amount:20,recurring:false}],cards:[]});
 state=clone(sample);primaryTab=true;connectionMode='supabase';backendReady=true;dbRevision=5;localGeneration=0;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(sample));
 await clearCloudPending(Infinity);localStorage.removeItem(CLOUD_PENDING_LOCAL_KEY);
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 const offlineResult=await saveState('offline-test');
 const pendingOffline=await getCloudPending();
 const browserCopy=loadBrowserStateSync();
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 rpcSaveCloud=async(snapshot,expected)=>({r:{ok:true},row:{revision:Number(expected)+1,state:clone(snapshot),updated_at:'2026-08-27T10:01:00Z'}});
 const syncResult=await persistSupabaseState(prepareKupaCloudState(state),'online-test',localGeneration);
 const pendingAfter=await getCloudPending();
 const base=clone(sample),local=clone(sample),remote=clone(sample);local.cash[0].amount=11;remote.expenses[0].amount=21;
 const merge=mergeKupaCloudState3Way(base,local,remote);
 const lc=clone(sample),rc=clone(sample);lc.cash[0].amount=12;rc.cash[0].amount=13;const conflict=mergeKupaCloudState3Way(base,lc,rc);
 const checkBase=[{id:'C1',amount:100,status:'בקופה',dueDate:'2026-09-01'}];
 const checkLocal=[...checkBase,{id:'C2',amount:200,status:'בקופה',dueDate:'2026-09-02'}];
 const checkRemote=[...checkBase,{id:'C3',amount:300,status:'בקופה',dueDate:'2026-09-03'}];
 const checks=mergeSharedChecks(checkBase,checkLocal,checkRemote);
 const checkConflict=mergeSharedChecks(checkBase,[{...checkBase[0],amount:110}],[{...checkBase[0],amount:120}]);
 // A real optimistic-concurrency retry: first RPC reports revision_conflict,
 // remote changed a different record, merge is clean, second RPC succeeds.
 await clearCloudPending(Infinity);const retryBase=clone(sample),retryLocal=clone(sample),retryRemote=clone(sample);
 retryLocal.cash[0].amount=15;retryRemote.expenses[0].amount=25;state=clone(retryLocal);dbRevision=10;localGeneration=20;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(retryBase));cloudConflictPending=false;
 let retryCalls=0;rpcSaveCloud=async(snapshot,expected)=>{retryCalls++;if(retryCalls===1)return{r:{ok:false},j:{message:'revision_conflict'},body:'revision_conflict'};return{r:{ok:true},row:{revision:12,state:clone(snapshot),updated_at:'2026-08-27T10:02:00Z'}}};
 readSupabaseDocument=async()=>({revision:11,state:prepareKupaCloudState(retryRemote),updated_at:'2026-08-27T10:01:30Z'});
 const retryResult=await persistSupabaseState(prepareKupaCloudState(retryLocal),'retry-test',localGeneration);
 return {
   offlineResult,pendingStored:!!pendingOffline,browserCopyStored:!!browserCopy,
   syncResult,pendingCleared:!pendingAfter,revision:6,
   disjointConflicts:merge.conflicts.length,mergedCash:merge.state.cash[0].amount,mergedExpense:merge.state.expenses[0].amount,
   sameRecordConflict:conflict.conflicts.includes('cash:CA1'),
   sharedDisjointConflicts:checks.conflicts.length,sharedIds:checks.checks.map(x=>x.id).sort(),
   sharedSameRecordConflict:checkConflict.conflicts.includes('check:C1')||checkConflict.conflicts.includes('checks:C1'),
   retryResult,retryCalls,retryRevision:dbRevision,retryCash:state.cash[0].amount,retryExpense:state.expenses[0].amount
 };
})()"""
kupa_expected = {
    "offlineResult": False,
    "pendingStored": True,
    "browserCopyStored": True,
    "syncResult": True,
    "pendingCleared": True,
    "revision": 6,
    "disjointConflicts": 0,
    "mergedCash": 11,
    "mergedExpense": 21,
    "sameRecordConflict": True,
    "sharedDisjointConflicts": 0,
    "sharedIds": ["C1", "C2", "C3"],
    "sharedSameRecordConflict": True,
    "retryResult": True,
    "retryCalls": 2,
    "retryRevision": 12,
    "retryCash": 15,
    "retryExpense": 25,
}

orders_expr = r"""(async()=>{
 const empty=()=>({version:4,businessName:'בדיקה',suppliers:[{id:'S1',name:'בסיס'}],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[{id:'N1',content:'בסיס',createdAt:'2026-08-27T10:00:00Z',updatedAt:'2026-08-27T10:00:00Z'}],importAudit:{},stage2Audit:{}});
 state=normalizeState(empty());primaryTab=true;cloudRevision=5;lastCloudState=prepareCloudState(state);localGeneration=1;cloudConflictBlocked=false;cloudSaveRequested=false;
 localStorage.setItem(CLOUD_AUTO_KEY,'1');saveSession({access_token:'test',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600});clearCloudPending();localSnapshot();
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 const offlineResult=await requestCloudSave('offline-test');
 const pendingOffline=cloudPendingExists(),pendingState=loadCloudPendingState();
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 rpcSave=async(snapshot,expected)=>({r:{ok:true},row:{revision:Number(expected)+1,state:clone(snapshot),updated_at:'2026-08-27T10:01:00Z'}});
 const syncResult=await requestCloudSave('online-test');
 const pendingAfter=cloudPendingExists();
 const base=normalizeState(empty()),local=clone(base),remote=clone(base);local.suppliers[0].name='מקומי';remote.notes[0].content='מרוחק';
 const merge=merge3(base,local,remote);
 const lc=clone(base),rc=clone(base);lc.suppliers[0].name='A';rc.suppliers[0].name='B';const conflict=merge3(base,lc,rc);
 const cb=[{id:'C1',amount:100,status:'בקופה',dueDate:'2026-09-01'}];
 const checks=mergeSharedChecks(cb,[...cb,{id:'C2',amount:200,status:'בקופה',dueDate:'2026-09-02'}],[...cb,{id:'C3',amount:300,status:'בקופה',dueDate:'2026-09-03'}]);
 const checkConflict=mergeSharedChecks(cb,[{...cb[0],amount:110}],[{...cb[0],amount:120}]);
 clearCloudPending();const retryBase=normalizeState(empty()),retryLocal=clone(retryBase),retryRemote=clone(retryBase);
 retryLocal.suppliers[0].name='מקומי-ריטריי';retryRemote.notes[0].content='מרוחק-ריטריי';state=clone(retryLocal);lastCloudState=prepareCloudState(retryBase);cloudRevision=10;localGeneration=30;cloudConflictBlocked=false;cloudSaveRequested=false;
 let retryCalls=0;rpcSave=async(snapshot,expected)=>{retryCalls++;if(retryCalls===1)return{r:{ok:false},j:{message:'revision_conflict'},txt:'revision_conflict'};return{r:{ok:true},row:{revision:12,state:clone(snapshot),updated_at:'2026-08-27T10:02:00Z'}}};
 readCloud=async()=>({revision:11,state:prepareCloudState(retryRemote),updated_at:'2026-08-27T10:01:30Z'});
 const retryResult=await requestCloudSave('retry-test');
 return {
   offlineResult,pendingStored:pendingOffline,pendingStateStored:!!pendingState,
   syncResult,pendingCleared:!pendingAfter,revision:6,
   disjointConflicts:merge.conflicts.length,mergedSupplier:merge.state.suppliers[0].name,mergedNote:merge.state.notes[0].content,
   sameRecordConflict:conflict.conflicts.includes('supplier:S1'),
   sharedDisjointConflicts:checks.conflicts.length,sharedIds:checks.checks.map(x=>x.id).sort(),
   sharedSameRecordConflict:checkConflict.conflicts.includes('check:C1'),
   retryResult,retryCalls,retryRevision:cloudRevision,retrySupplier:state.suppliers[0].name,retryNote:state.notes[0].content
 };
})()"""
orders_expected = {
    "offlineResult": False,
    "pendingStored": True,
    "pendingStateStored": True,
    "syncResult": True,
    "pendingCleared": True,
    "revision": 6,
    "disjointConflicts": 0,
    "mergedSupplier": "מקומי",
    "mergedNote": "מרוחק",
    "sameRecordConflict": True,
    "sharedDisjointConflicts": 0,
    "sharedIds": ["C1", "C2", "C3"],
    "sharedSameRecordConflict": True,
    "retryResult": True,
    "retryCalls": 2,
    "retryRevision": 12,
    "retrySupplier": "מקומי-ריטריי",
    "retryNote": "מרוחק-ריטריי",
}

ok = run("kupa-sync", ROOT / "netunim-kupa/site", kupa_expr, kupa_expected)
ok = run("orders-sync", ROOT / "netunim-orders/site", orders_expr, orders_expected) and ok
raise SystemExit(0 if ok else 1)
