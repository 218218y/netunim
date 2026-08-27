import json

from browser_harness import BrowserSession, ROOT


def run(label, site, expression, expected):
    try:
        with BrowserSession(site, label + "-data") as browser:
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


kupa_expr = r"""(()=>{
 const sample=normalizeState({
   version:4,businessName:'בדיקה',
   bank:{currentBalance:1200,updatedAt:'2026-08-27T10:00:00Z',asOfDate:'2026-08-27',snapshotSeq:7,snapshotToken:'S',adjustments:[{id:'A1',amount:25,type:'manual'}]},
   checks:[{id:'C1',name:'לקוח',amount:300,dueDate:'2026-09-01',status:'בקופה'}],
   credits:[],cash:[{id:'CA1',amount:40}],expenses:[{id:'E1',amount:20,recurring:false}],cards:[{name:'VISA'}]
 });
 const payload=payloadFromState(sample,12),round=stateFromPayload(payload);
 let malformedRejected=false;try{stateFromPayload({_meta:{format:'kupa-portable'},cash:[]})}catch(e){malformedRejected=true}
 const cloud=prepareKupaCloudState(sample);
 const cloudValid=validKupaCloudState(cloud);
 const cloudChecksRejected=!validKupaCloudState({...cloud,checks:[]});
 const cloudLegacyBankRejected=!validKupaCloudState({...cloud,bank:{...cloud.bank,adjustments:[{id:'OLD',type:'check_deposit',amount:100}]}});
 const base=clone(sample);
 const local=clone(sample);local.cash[0].amount=41;
 const remote=clone(sample);remote.expenses[0].amount=21;
 const disjoint=mergeState3Way(base,local,remote);
 const localConflict=clone(sample);localConflict.cash[0].amount=42;
 const remoteConflict=clone(sample);remoteConflict.cash[0].amount=43;
 const conflict=mergeState3Way(base,localConflict,remoteConflict);
 return {
   metaFormat:payload._meta.format,
   metaRevision:payload._meta.revision,
   roundCheckAmount:round.state.checks[0].amount,
   roundCashAmount:round.state.cash[0].amount,
   malformedRejected,
   cloudValid,cloudChecksRejected,cloudLegacyBankRejected,
   disjointConflicts:disjoint.conflicts.length,
   disjointCash:disjoint.state.cash[0].amount,
   disjointExpense:disjoint.state.expenses[0].amount,
   sameRecordConflict:conflict.conflicts.includes('cash:CA1')
 };
})()"""
kupa_expected = {
    "metaFormat": "kupa-portable",
    "metaRevision": 12,
    "roundCheckAmount": 300,
    "roundCashAmount": 40,
    "malformedRejected": True,
    "cloudValid": True,
    "cloudChecksRejected": True,
    "cloudLegacyBankRejected": True,
    "disjointConflicts": 0,
    "disjointCash": 41,
    "disjointExpense": 21,
    "sameRecordConflict": True,
}

orders_expr = r"""(()=>{
 const empty=()=>({
   version:4,businessName:'בדיקה',suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],
   inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[],importAudit:{},stage2Audit:{}
 });
 const sample=normalizeState({...empty(),suppliers:[{id:'S1',name:'ספק'}],notes:[{id:'N1',content:'פתק',createdAt:'2026-08-27T10:00:00Z',updatedAt:'2026-08-27T10:00:00Z'}],checks:[{id:'C1',name:'לקוח',amount:300,dueDate:'2026-09-01',status:'בקופה'}]});
 const payload=prepareState(sample),round=validateRestoreJson(payload);
 let wrongFormat=false,missing=false,future=false;
 try{validateRestoreJson({...payload,_meta:{...payload._meta,format:'other-app'}})}catch(e){wrongFormat=true}
 try{const x=clone(payload);delete x.transactions;validateRestoreJson(x)}catch(e){missing=true}
 try{validateRestoreJson({...payload,version:99,_meta:{...payload._meta,schemaVersion:99}})}catch(e){future=true}
 const cloud=prepareCloudState(sample);
 const cloudValid=validOrderCloudState(cloud),cloudChecksRejected=!validOrderCloudState({...cloud,checks:[]});
 const base=clone(sample),local=clone(sample),remote=clone(sample);
 local.suppliers[0].name='מקומי';remote.notes[0].content='מרוחק';
 const disjoint=merge3(base,local,remote);
 const lc=clone(sample),rc=clone(sample);lc.suppliers[0].name='A';rc.suppliers[0].name='B';
 const conflict=merge3(base,lc,rc);
 return {
   metaFormat:payload._meta.format,
   roundSupplier:round.suppliers[0].name,
   roundCheckAmount:round.checks[0].amount,
   wrongFormat,missing,future,cloudValid,cloudChecksRejected,
   disjointConflicts:disjoint.conflicts.length,
   disjointSupplier:disjoint.state.suppliers[0].name,
   disjointNote:disjoint.state.notes[0].content,
   sameRecordConflict:conflict.conflicts.includes('supplier:S1')
 };
})()"""
orders_expected = {
    "metaFormat": "order-management-portable",
    "roundSupplier": "ספק",
    "roundCheckAmount": 300,
    "wrongFormat": True,
    "missing": True,
    "future": True,
    "cloudValid": True,
    "cloudChecksRejected": True,
    "disjointConflicts": 0,
    "disjointSupplier": "מקומי",
    "disjointNote": "מרוחק",
    "sameRecordConflict": True,
}

ok = run("kupa-data", ROOT / "netunim-kupa/site", kupa_expr, kupa_expected)
ok = run("orders-data", ROOT / "netunim-orders/site", orders_expr, orders_expected) and ok
raise SystemExit(0 if ok else 1)
