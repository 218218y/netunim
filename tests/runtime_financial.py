import json

from browser_harness import BrowserSession, ROOT


def run(label, site, expression, expected):
    try:
        with BrowserSession(site, label + "-financial") as browser:
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


kexpr = r"""(()=>{
 const mkState=(seq,checks=[])=>normalizeState({version:4,bank:{currentBalance:1000,updatedAt:'2026-08-26T10:00:00Z',asOfDate:'2026-08-26',snapshotSeq:seq,snapshotToken:'T',adjustments:[]},checks,credits:[],cash:[],expenses:[],cards:[]});
 const ev=(seq,delta,id='C1')=>({seq,at:'2026-08-26T10:01:00Z',delta,kind:'check_effect_delta',checkId:id});
 const out={};
 state=mkState(10,[]);sharedChecksBase=[];sharedChecksBankEvents=[ev(11,100)];out.deposit=bankCurrentBalance();
 state=mkState(11,[]);sharedChecksBase=[];sharedChecksBankEvents=[ev(11,100),ev(12,-100)];out.returnAfterSnapshot=bankCurrentBalance();
 state=mkState(10,[]);sharedChecksBase=[];sharedChecksBankEvents=[ev(11,100),ev(12,30),ev(13,-130)];out.amountChangeThenDelete=bankCurrentBalance();
 const baseOpen=[{id:'C1',amount:100,status:'בקופה',dueDate:'2026-09-01'}],localDep=[{id:'C1',amount:100,status:'הופקד - במעקב',dueDate:'2026-09-01'}];
 state=mkState(10,localDep);sharedChecksBase=normalizeSharedChecks(baseOpen);sharedChecksBankEvents=[];out.pendingDeposit=bankCurrentBalance();
 const baseDep=[{id:'C1',amount:100,status:'הופקד - במעקב',dueDate:'2026-09-01'}],localRet=[{id:'C1',amount:100,status:'חזר',dueDate:'2026-09-01'}];
 state=mkState(10,localRet);sharedChecksBase=normalizeSharedChecks(baseDep);sharedChecksBankEvents=[];out.pendingReturn=bankCurrentBalance();
 const repairRemote=[{id:'R1',amount:75,status:'בקופה',dueDate:'2026-09-02'}];
 localStorage.removeItem(SHARED_CHECKS_PENDING_KEY);sharedChecksBootstrapActive=true;
 const repaired=mergeSharedChecks(repairRemote,[],repairRemote);out.bootRepairCount=repaired.checks.length;out.bootRepairApplied=repaired.repairedEmptyBootstrap;
 const laterProtected=mergeSharedChecks(repairRemote,[],repairRemote);out.postRepairProtectedCount=laterProtected.checks.length;
 const explicitDelete=mergeSharedChecks(repairRemote,[],repairRemote,{deleteIds:['R1']});out.explicitDeleteCount=explicitDelete.checks.length;
 return out;
})()"""
kexpected = {
    "deposit": 1000,
    "returnAfterSnapshot": 1000,
    "amountChangeThenDelete": 1000,
    "pendingDeposit": 1000,
    "pendingReturn": 1000,
    "bootRepairCount": 1,
    "bootRepairApplied": True,
    "postRepairProtectedCount": 1,
    "explicitDeleteCount": 0,
}

oexpr = r"""(()=>{
 const ev=(seq,delta,id='C1')=>({seq,at:'2026-08-26T10:01:00Z',delta,kind:'check_effect_delta',checkId:id});
 state.checks=[];checksCloudBase=[];checksBankEvents=[ev(11,100),ev(12,-100)];
 const k={bank:{currentBalance:1000,updatedAt:'2026-08-26T10:00:00Z',asOfDate:'2026-08-26',snapshotSeq:11,adjustments:[]},credits:[],expenses:[],cash:[]};
 const a=computeKupaNetReadout(k).bank;
 state.checks=[{id:'C1',amount:100,status:'הופקד - במעקב',dueDate:'2026-09-01'}];checksCloudBase=[{id:'C1',amount:100,status:'בקופה',dueDate:'2026-09-01'}];checksBankEvents=[];
 const b=computeKupaNetReadout({bank:{currentBalance:1000,updatedAt:'2026-08-26T10:00:00Z',asOfDate:'2026-08-26',snapshotSeq:10,adjustments:[]},credits:[],expenses:[],cash:[]}).bank;
 return {returnAfterSnapshot:a,pendingDeposit:b};
})()"""
oexpected = {"returnAfterSnapshot": 1000, "pendingDeposit": 1000}

ok = run("kupa-financial", ROOT / "netunim-kupa/site", kexpr, kexpected)
ok = run("orders-financial", ROOT / "netunim-orders/site", oexpr, oexpected) and ok
raise SystemExit(0 if ok else 1)
