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

breakdown_fixture = r"""
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const later=new Date(now.getFullYear(),now.getMonth(),now.getDate()+10),due=[later.getFullYear(),String(later.getMonth()+1).padStart(2,'0'),String(later.getDate()).padStart(2,'0')].join('-');
 const fixture={version:4,credits:[],cash:[],cards:[],cashflowSettings:{businessCheckCutoffDay:28,homeCheckCutoffDay:28},bank:{currentBalance:10000,asOfDate:today,updatedAt:today,source:'hapoalim',adjustments:[],feed:{balance:10000,syncedAt:today,transactions:[]},homeFeed:{balance:5000,syncedAt:today,transactions:[]}},
   checks:[{id:'b-check',name:'צ׳ק עסקי',account:'עסקי',status:'בקופה',amount:50,dueDate:today},{id:'h-check',name:'צ׳ק ביתי',account:'ביתי',status:'בקופה',amount:60,dueDate:today}],
   expenses:[{id:'b-exp',name:'הוצאה עסקית',account:'עסקי',active:true,recurring:false,amount:30,date:today},{id:'h-exp',name:'הוצאה ביתית',account:'ביתי',active:true,recurring:false,amount:40,date:today}],
   creditSync:{version:4,profiles:[{profileId:'test',provider:'max',accounts:[{accountNumber:'2222',pendingStatus:'success',pendingFetchedAt:today,balanceDate:due,txns:[{id:'b',status:'completed',processedDate:due,chargedAmount:-100.11,chargedCurrency:'ILS'},{id:'p',status:'pending',transactionDate:today,chargedAmount:-10.10,chargedCurrency:'ILS'}]},{accountNumber:'3333',txns:[{id:'h',status:'completed',processedDate:due,chargedAmount:-2000.22,chargedCurrency:'ILS'}]}]}],cardMappings:{'test:2222':{included:true,account:'עסקי'},'test:3333':{included:true,account:'ביתי'}}}};
"""


def run_breakdown(app):
    with BrowserSession(ROOT / f"netunim-{app}/site", f"{app}-cashflow-breakdown") as browser:
        setup = "state=normalizeState(fixture);domainsBankView.renderBank();" if app == 'kupa' else "kupaCloudReadState=fixture;state.checks=fixture.checks;ui.kupaSubView='bank';ui.bankAccountView='business';domainsFinanceView.renderKupa();"
        browser.evaluate("(()=>{"+breakdown_fixture+setup+"return true;})()")
        for width in (1280, 390):
            browser.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            for role, card, other, expected in [('business', '2222', '3333', '90.21'), ('home', '3333', '2222', '1,980.22')]:
                select = f"ui.bankAccountView='{role}';domainsFinanceView.renderKupa();" if app == 'orders' else ''
                action = 'orders-cashflow-breakdown' if app == 'orders' else 'cashflow-breakdown'
                result = browser.evaluate(f"""(()=>{{
                  {select}
                  const trigger=document.querySelector('[data-action="{action}"][data-click-arg0="{role}"]');
                  if(!trigger||trigger.tagName!=='BUTTON')throw new Error('Missing cash-flow button, including when available balance is absent');
                  trigger.click();
                  const panel=document.querySelector('#modal .cashflow-breakdown'),backdrop=document.getElementById('modalBackdrop');
                  if(!panel||!backdrop.classList.contains('open'))throw new Error('Cash-flow button failed to open the dialog');
                  const text=panel.textContent;
                  if(!text.includes('{card}')||text.includes('{other}')||!text.includes('{expected}'))throw new Error('Wrong account or total: '+text);
                  if(panel.querySelectorAll('tfoot').length!==3)throw new Error('Missing credit, expense or check subtotal');
                  if(panel.scrollWidth>panel.clientWidth+2)throw new Error('Drilldown overflows at {width}px');
                  const textRight=element=>{{const range=document.createRange();range.selectNodeContents(element);return range.getBoundingClientRect().right}};
                  const amountRight=textRight(panel.querySelector('tfoot td[dir="ltr"]'));
                  for(const total of panel.querySelectorAll('.cashflow-breakdown-total>b'))if(Math.abs(textRight(total)-amountRight)>2)throw new Error('Summary amounts do not align with the amount column at {width}px');
                  const close=document.querySelector('#modal .modal-foot [data-action="close-modal"],#modal .modal-foot [data-modal-save]');close.click();
                  if(backdrop.classList.contains('open'))throw new Error('Dialog close button failed');
                  return true;
                }})()""")
                assert result is True
        for days in (1, 2):
            browser.evaluate("(()=>{"+breakdown_fixture+f"""
              const past=new Date(now.getFullYear(),now.getMonth(),now.getDate()-{days}),pastDay=[past.getFullYear(),String(past.getMonth()+1).padStart(2,'0'),String(past.getDate()).padStart(2,'0')].join('-');
              fixture.creditSync.profiles[0].accounts[0].txns=[{{id:'elapsed-unknown',status:'completed',processedDate:pastDay,chargedAmount:null,originalAmount:null,chargedCurrency:'ILS'}}];
              {setup}
              return true;
            }})()""")
            action = 'orders-cashflow-breakdown' if app == 'orders' else 'cashflow-breakdown'
            browser.evaluate(f"""(()=>{{
              document.querySelector('[data-action="{action}"][data-click-arg0="business"]').click();
              const text=document.querySelector('#modal .cashflow-breakdown').textContent;
              if({days}===1&&!text.includes('התחזית חלקית'))throw new Error('Elapsed unknown amount disappeared from partial forecast');
              if({days}===2&&!text.includes('סכום לא ידוע'))throw new Error('Expired unknown amount has no explicit warning');
              document.querySelector('#modal .modal-foot [data-action="close-modal"],#modal .modal-foot [data-modal-save]').click();
              return true;
            }})()""")
        action = 'orders-cashflow-alert-lead' if app == 'orders' else 'update-cashflow-alert-lead'
        browser.evaluate(f"""(()=>{{
          uiSettings.renderSettings();
          const fields=[...document.querySelectorAll('[data-change="{action}"]')];
          if(fields.length!==2||fields.some(field=>field.value!=='14'))throw new Error('Both account settings must display the 14-day default');
          if(fields.some(field=>field.min!=='0'||field.max!=='365'))throw new Error('Invalid notification-day limits');
          return true;
        }})()""")
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print(f'{app}: cash-flow drilldown opens and closes for both accounts, totals match, desktop/mobile fit')


ok = run("kupa-financial", ROOT / "netunim-kupa/site", kexpr, kexpected)
ok = run("orders-financial", ROOT / "netunim-orders/site", oexpr, oexpected) and ok
run_breakdown('kupa')
run_breakdown('orders')
raise SystemExit(0 if ok else 1)
