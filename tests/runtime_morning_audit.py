"""Morning debt safety regressions in disposable Chromium; no external services."""
import json
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

SETUP = LOCAL_CLOUD + r"""
window.auditAssert=(ok,msg)=>{if(!ok)throw new Error(msg)};
window.auditWait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw new Error('audit timeout')};
window.auditConfirmation=()=>({open:!!document.getElementById('confirmBackdrop')?.classList.contains('open'),title:document.getElementById('confirmTitle')?.textContent||'',message:document.getElementById('confirmMessage')?.textContent||''});
window.auditWaitForIssueConfirmation=async()=>{const before=window.auditConfirmation();window.auditAssert(!before.open,'stale confirmation before Morning issue: '+before.title+' | '+before.message);await window.auditWait(()=>{const current=window.auditConfirmation();return current.open&&current.title==='הפקת מסמך רשמי'&&current.message.includes('Audit fixture')})};
window.auditCalls=[];
window.auditServer=JSON.parse(localStorage.getItem('audit.server')||'{}');
window.auditSetServer=patch=>{Object.assign(window.auditServer,patch);localStorage.setItem('audit.server',JSON.stringify(window.auditServer))};
cloudAuth.supaFetch=async(path,options)=>{
 const req=JSON.parse(options.body);window.auditCalls.push(req);
 const s=window.auditServer;let data={ok:true};
 if(req.action==='status')data={ok:true,configured:true,available:true,environment:'sandbox',operation:s.operation||null,unresolved:!!s.operation&&!['created','failed'].includes(s.operation.state),retryable_reserved:s.operation?.state==='reserved'};
 if(req.action==='reserve')data={ok:true,reserved:true,operation:{operation_id:req.operation_id,state:'reserved'}};
 if(req.action==='abandon_reservation'){window.auditSetServer({operation:{...s.operation,state:'failed'}});data={ok:true,abandoned:true,operation:window.auditServer.operation}}
 if(req.action==='create'){
  const op={operation_id:req.operation_id,state:s.uncertain?'needs_reconciliation':'created',document_type:req.document.type,amount:req.document.amount,document_id:'00000000-0000-4000-8000-000000000099',document_number:99,verified_at:s.uncertain?null:new Date().toISOString()};
  window.auditSetServer({operation:op});
  if(s.uncertain)return new Response(JSON.stringify({ok:false,uncertain:true,message:'lost response'}),{status:502});
  data={ok:true,verified:true,document:{id:op.document_id,number:99,type:op.document_type,amount:op.amount}};
 }
 if(req.action==='document_pdf')return new Response(new TextEncoder().encode('%PDF-1.4\nfixture'),{headers:{'Content-Type':'application/pdf'}});
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
window.auditDebt=()=>state.customerDebts.find(d=>d.id==='AUDIT');
window.auditProgress=async()=>{const m=await import('./assets/js/shared/customer-debt-progress.js');return m.customerDebtProgressData(window.auditDebt())};
window.auditOpen=async()=>{switchView('customers');openMorningDocument('AUDIT');await window.auditWait(()=>document.querySelector('[data-action="morning-create"]')&&!document.querySelector('[data-action="morning-create"]').disabled)};
window.auditIssue=async(type,amount,policy={})=>{
 scheduleSave('fixture debt before issuance');window.auditSetServer({operation:null});await window.auditOpen();
 document.querySelector('input[name="morningDocumentType"][value="'+type+'"]').click();
 document.getElementById('morningAmount').value=String(amount);
 for(const [key,value] of Object.entries(policy))document.getElementById(key).checked=value;
 const pendingConfirmation=window.auditWaitForIssueConfirmation();document.querySelector('[data-action="morning-create"]').click();
 await pendingConfirmation;
 document.getElementById('confirmAccept').click();
 await window.auditWait(()=>window.auditServer.operation&&document.querySelector('[data-action="morning-create"]').textContent!=='מפיק…');
};
return true;
"""

def js(browser, source):
    return browser.evaluate('(async()=>{'+source+'})()', timeout=60)


def seed(browser):
    js(browser, SETUP)
    js(browser, "state=normalizeState({version:5,customerDebts:[{id:'AUDIT',customerName:'Audit fixture',amount:100,paid:false,invoiceIssued:false},{id:'OTHER',customerName:'Other fixture',amount:100}]});primaryTab=true;return true;")


def reload(browser):
    js(browser, "scheduleSave('audit fixture');clearTimeout(saveTimer);saveTimer=null;return true;")
    browser._navigate()
    browser.evaluate('appReady.then(()=>true)')
    js(browser, SETUP)


def document_matrix():
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-matrix') as browser:
        seed(browser)
        result=js(browser, r"""
        const passed=[];
        for(const type of [320,400,305]){
          state.customerDebts[0]={id:'AUDIT',customerName:'Audit fixture',amount:100,paid:false,invoiceIssued:false};
          await window.auditIssue(type,100);const p=await window.auditProgress();
          window.auditAssert(p.paymentApplied===(type===305?0:100)&&p.invoiceApplied===(type===400?0:100),'document type '+type);
          passed.push('type-'+type);
        }
        state.customerDebts[0]={id:'AUDIT',customerName:'Audit fixture',amount:100,paid:false,invoiceIssued:false};
        for(const [type,amount,payment,invoice] of [[320,20,20,20],[400,30,50,20],[305,40,50,60],[320,150,100,100]]){
          await window.auditIssue(type,amount);const p=await window.auditProgress();
          window.auditAssert(p.paymentApplied===payment&&p.invoiceApplied===invoice,'partial/over balance');
          window.auditAssert(p.remainingPayment>=0&&p.remainingInvoice>=0,'negative remainder');
        }
        passed.push('partial-sequence','above-balance');
        for(const kind of ['payment','invoice']){
          state.customerDebts[0]={id:'AUDIT',customerName:'Audit fixture',amount:100,paid:false,invoiceIssued:false,debtProgress:[{id:'manual-'+kind,kind,action:'add',amount:30,source:'manual',createdAt:new Date().toISOString()}]};
          await window.auditIssue(320,30,{[kind==='payment'?'morningApplyPayment':'morningApplyInvoice']:false});
          const p=await window.auditProgress();window.auditAssert(p.paymentApplied===30&&p.invoiceApplied===30,'manual opt-out '+kind);
          passed.push('manual-'+kind+'-opt-out');
        }
        const before=JSON.stringify(window.auditDebt());let saves=0,renders=0;
        const originalSave=storagePersistence.scheduleSave,originalRender=domainsCustomers.view.renderCustomers;
        storagePersistence.scheduleSave=(...args)=>{saves++;return originalSave(...args)};
        domainsCustomers.view.renderCustomers=(...args)=>{renders++;return originalRender(...args)};
        await reconcileMorningDocument();await reconcileMorningDocument();
        window.auditAssert(JSON.stringify(window.auditDebt())===before&&saves===0&&renders===0,'create/reconciliation duplicate saved or rendered');
        const op=window.auditServer.operation;
        domainsCustomers.editor.applyVerifiedMorningDocument({debtId:'AUDIT',operationId:op.operation_id,type:320,amount:30,applyInvoice:false});
        window.auditAssert(saves===0&&renders===0,'durable direct duplicate saved or rendered');
        setCustomerFlag('AUDIT','paid',false);const resetBefore=JSON.stringify(window.auditDebt().debtProgress);
        domainsCustomers.editor.applyVerifiedMorningDocument({debtId:'AUDIT',operationId:op.operation_id,type:320,amount:30,applyInvoice:false});
        window.auditAssert((await window.auditProgress()).paymentApplied===0&&JSON.stringify(window.auditDebt().debtProgress)===resetBefore,'reset event resurrected');
        passed.push('idempotent-save-render','reset-replay');return passed;
        """)
        print('PASS Morning browser matrix:', ', '.join(result))


def recovery_lock():
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-recovery-lock') as browser:
        seed(browser)
        js(browser, "window.auditSetServer({uncertain:true});await window.auditIssue(320,30);return true;")
        reload(browser)
        js(browser, r"""
        const before=JSON.stringify(window.auditDebt()),key='orders.morning.pending-issuance.v1',recovery=localStorage.getItem(key);
        for(const values of [{dAmount:'150'},{dPaid:'partial',dAddPayment:'30'},{dInvoice:'partial',dAddInvoice:'30'},{dPaid:'true'},{dInvoice:'true'}]){
          openDebtModal('AUDIT');
          for(const id of ['dAmount','dPaid','dInvoice','dAddPayment','dAddInvoice'])window.auditAssert(document.getElementById(id).disabled,'locked field '+id);
          window.auditAssert(document.querySelector('[data-action="delete-debt"]').disabled,'delete UI lock');
          for(const [id,value] of Object.entries(values))document.getElementById(id).value=value;
          saveDebt('AUDIT');window.auditAssert(JSON.stringify(window.auditDebt())===before,'financial edit during recovery '+JSON.stringify(values));
        }
        for(const field of ['paid','invoiceIssued']){setCustomerFlag('AUDIT',field,true);window.auditAssert(JSON.stringify(window.auditDebt())===before,'table flag during recovery')}
        await deleteDebt('AUDIT');window.auditAssert(JSON.stringify(window.auditDebt())===before,'delete during recovery');
        customerUi.customerTab='debts';customerUi.customerBulkSelected=new Set(['AUDIT','OTHER']);await deleteSelectedCustomerRows();
        window.auditAssert(state.customerDebts.length===2,'bulk delete during recovery');
        openDebtModal('AUDIT');document.getElementById('dNote').value='Allowed note';document.getElementById('dSupplied').value='true';saveDebt('AUDIT');
        window.auditAssert(window.auditDebt().note==='Allowed note'&&window.auditDebt().supplied,'nonfinancial edits blocked');
        setCustomerFlag('OTHER','paid',true);window.auditAssert(state.customerDebts.find(d=>d.id==='OTHER').paid,'unrelated debt blocked');
        openMorningDocument('OTHER');window.auditAssert(localStorage.getItem(key)===recovery,'rebound recovery');
        await openMorningDocument('AUDIT');const calls=window.auditCalls.filter(c=>c.action==='create').length;
        await createMorningDocument(document.querySelector('[data-action="morning-create"]'));window.auditAssert(window.auditCalls.filter(c=>c.action==='create').length===calls,'uncertain retry POST');
        window.auditSetServer({operation:{...window.auditServer.operation,state:'created',verified_at:new Date().toISOString()}});
        const recovered=await recoverPendingMorningOperation();
        window.auditAssert(!localStorage.getItem(key),'recovery not cleared after durable reconciliation '+JSON.stringify({recovered,context:JSON.parse(localStorage.getItem(key)),debt:window.auditDebt(),busy:cloudBusy,requested:cloudSaveRequested,conflict:cloudConflictBlocked}));
        const p=await window.auditProgress();window.auditAssert(p.paymentApplied===30&&p.invoiceApplied===30,'semantic double deduction');
        openDebtModal('AUDIT');window.auditAssert(!document.getElementById('dAmount').disabled,'lock not released');
        document.getElementById('dAddPayment').value='10';saveDebt('AUDIT');window.auditAssert((await window.auditProgress()).paymentApplied===40,'post-recovery payment blocked');
        return true;
        """)
        print('PASS Morning reload: amount/payment/invoice/flags/delete/bulk locked; notes, supplied and other debts allowed; reconciliation applies once and releases lock')


def cleanup_and_persistence():
    for terminal in ['created','failed','reserved']:
        with BrowserSession(ROOT/'netunim-orders/site', 'morning-cleanup-'+terminal) as browser:
            seed(browser)
            js(browser, "window.auditSetServer({uncertain:true});await window.auditIssue(320,30);return true;")
            reload(browser)
            js(browser, r"""
            window.auditRemove=Storage.prototype.removeItem;
            Storage.prototype.removeItem=function(key){if(key==='orders.morning.pending-issuance.v1')throw new Error('fixture remove failure');return window.auditRemove.call(this,key)};
            window.auditSetServer({operation:{...window.auditServer.operation,state:"""+json.dumps(terminal)+r""",verified_at:new Date().toISOString()}});
            await openMorningDocument('AUDIT');await reconcileMorningDocument();
            window.auditAssert(!!localStorage.getItem('orders.morning.pending-issuance.v1'),'failed remove lost Recovery');
            window.auditAssert(document.querySelector('[data-action="morning-create"]').disabled,'failed remove unlocked issuance');
            const before=JSON.stringify(window.auditDebt());setCustomerFlag('AUDIT','paid',true);window.auditAssert(JSON.stringify(window.auditDebt())===before,'failed cleanup unlocked debt');
            Storage.prototype.removeItem=window.auditRemove;await recoverPendingMorningOperation();
            window.auditAssert(!localStorage.getItem('orders.morning.pending-issuance.v1'),'cleanup retry failed');
            return true;
            """)
            print('PASS Morning cleanup failure remains locked and retries:', terminal)
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-persistence') as browser:
        seed(browser)
        js(browser, r"""
        window.auditRealSave=storagePersistence.scheduleSave;
        storagePersistence.scheduleSave=()=>false;
        await window.auditIssue(320,30);
        window.auditAssert(window.auditDebt().debtProgress.length===2&&!!localStorage.getItem('orders.morning.pending-issuance.v1'),'failed persistence lost recovery');
        storagePersistence.scheduleSave=window.auditRealSave;
        await recoverPendingMorningOperation();
        window.auditAssert(window.auditDebt().debtProgress.length===2&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'replay did not re-persist exactly once');
        return true;
        """)
        reload(browser)
        js(browser, "window.auditAssert((await window.auditProgress()).paymentApplied===30,'replay persistence missing after reload');return true;")
        print('PASS Morning persistence failure: replay persists existing events; survives reload')
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-unknown-result') as browser:
        seed(browser)
        js(browser, r"""
        const apply=domainsCustomers.editor.applyVerifiedMorningDocument;
        domainsCustomers.editor.applyVerifiedMorningDocument=()=>({changed:false,reason:'future-unknown-result'});
        await window.auditIssue(320,30);
        window.auditAssert(!!localStorage.getItem('orders.morning.pending-issuance.v1'),'unknown result cleared recovery');
        await reconcileMorningDocument();window.auditAssert(document.querySelector('[data-action="morning-create"]').disabled,'unknown result unlocked issuance');
        domainsCustomers.editor.applyVerifiedMorningDocument=apply;await recoverPendingMorningOperation();
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'known replay did not recover');return true;
        """)
        print('PASS Morning unknown application outcome: fail closed, recover only after durable known result')


def crash_snapshots():
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-crash-reserved') as browser:
        seed(browser)
        js(browser, r"""
        const recovery=await import('./assets/js/domains/customers/morning-debt-recovery.js');
        const operationId=crypto.randomUUID();
        recovery.saveMorningDebtRecoveryContext(recovery.createMorningDebtRecoveryContext({operationId,debtId:'AUDIT',type:320,amount:30,applyPayment:true,applyInvoice:true}));
        window.auditSetServer({operation:{operation_id:operationId,state:'reserved',document_type:320,amount:30}});return true;
        """)
        reload(browser)
        js(browser, r"""
        const result=await recoverPendingMorningOperation();
        window.auditAssert(result.state==='abandoned'&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'pre-POST reservation not abandoned');
        window.auditAssert(window.auditCalls.some(c=>c.action==='abandon_reservation')&&!window.auditCalls.some(c=>c.action==='create'),'pre-POST crash caused a POST');
        window.auditAssert((await window.auditProgress()).paymentApplied===0,'pre-POST crash changed debt');return true;
        """)
        print('PASS Morning crash after reserve before POST: reload abandons reservation without document or debt mutation')
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-crash-local-persistence') as browser:
        seed(browser)
        js(browser, r"""
        scheduleSave('durable base');clearTimeout(saveTimer);saveTimer=null;await files.browserStateWritePromise;
        await requestCloudSave('durable fixture base');cloudAuth.cloudEnabled=()=>false;
        // Navigation runs the production pagehide safety snapshot. Keep persistence
        // unavailable there too, so this fixture actually models a crash before disk save.
        storagePersistence.scheduleSave=()=>false;storageBrowser.localSnapshot=()=>false;await window.auditIssue(320,30);
        window.auditAssert(window.auditDebt().debtProgress.length===2,'verified event missing before simulated crash');return true;
        """)
        browser._navigate()
        browser.evaluate('appReady.then(()=>true)')
        js(browser, SETUP)
        js(browser, r"""
        window.auditAssert((await window.auditProgress()).paymentApplied===0,'failed persistence unexpectedly survived crash');
        await recoverPendingMorningOperation();await recoverPendingMorningOperation();
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&window.auditDebt().debtProgress.length===2,'post-crash replay is not exactly once');
        window.auditAssert(!localStorage.getItem('orders.morning.pending-issuance.v1'),'successful post-crash replay retained recovery');return true;
        """)
        print('PASS Morning crash after verification before persistence: reload restores binding and applies exactly once')


def ownership():
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-ownership') as browser:
        seed(browser)
        js(browser, "scheduleSave('fixture');clearTimeout(saveTimer);return true;")
        with browser.second_tab():
            js(browser, SETUP)
            js(browser, r"""
            window.auditAssert(!primaryTab,'second tab unexpectedly primary');
            await openMorningDocument('AUDIT');await createMorningDocument(document.querySelector('[data-action="morning-create"]'));
            await openStandaloneMorningDocument();await createMorningDocument(document.querySelector('[data-action="morning-create"]'));
            window.auditAssert(!window.auditCalls.some(c=>['reserve','create'].includes(c.action)),'secondary issued Morning');return true;
            """)
        js(browser, r"""
        window.auditAssert(primaryTab,'first tab lost ownership');await window.auditIssue(320,20);
        window.auditSetServer({operation:null});await window.auditOpen();
        const pendingConfirmation=window.auditWaitForIssueConfirmation();document.querySelector('[data-action="morning-create"]').click();await pendingConfirmation;
        const before=window.auditCalls.filter(c=>['reserve','create'].includes(c.action)).length;
        primaryTab=false;document.getElementById('confirmAccept').click();await new Promise(r=>setTimeout(r,100));
        window.auditAssert(window.auditCalls.filter(c=>['reserve','create'].includes(c.action)).length===before,'ownership loss during confirmation issued Morning');primaryTab=true;return true;
        """)
        print('PASS Morning two real tabs: secondary blocked, primary issues, ownership loss during confirmation stops before reserve/POST')


def remotely_missing_debt():
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-remote-deletion') as browser:
        seed(browser)
        js(browser, r"""
        window.auditSetServer({uncertain:true});await window.auditIssue(320,30);
        await requestCloudSave('fixture before remote removal');clearTimeout(saveTimer);saveTimer=null;
        const original=structuredClone(window.auditDebt());
        window.auditCloudHead={revision:cloudRevision+1,state:prepareCloudState(state)};
        window.auditCloudHead.state.customerDebts=window.auditCloudHead.state.customerDebts.filter(d=>d.id!=='AUDIT');
        window.auditSetServer({operation:{...window.auditServer.operation,state:'created',verified_at:new Date().toISOString()}});
        const missing=await recoverPendingMorningOperation();
        window.auditAssert(!missing.ok&&!!localStorage.getItem('orders.morning.pending-issuance.v1'),'missing debt discarded verified payment recovery');
        window.auditCloudHead.state.customerDebts.push(original);window.auditCloudHead.revision++;await recoverPendingMorningOperation();
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'restored debt could not recover verified payment');return true;
        """)
        print('PASS Morning remote debt removal preserves recovery; restoring original debt recovers both dimensions')


def two_computers():
    for scenario in ['partial-payments','reset-and-new-payment','distinct-morning']:
        with BrowserSession(ROOT/'netunim-orders/site', 'morning-device-A') as a, BrowserSession(ROOT/'netunim-orders/site', 'morning-device-B') as b:
            seed(a)
            if scenario=='reset-and-new-payment':
                js(a, "window.auditDebt().debtProgress=[{id:'KNOWN',kind:'payment',action:'add',amount:30,source:'manual',createdAt:'2026-09-09T09:00:00.000Z'}];return true;")
            initial=a.evaluate('state')
            for browser in (a,b):
                js(browser, SETUP)
                js(browser, "state=normalizeState("+json.dumps(initial)+");primaryTab=true;localGeneration=0;cloudRevision=10;lastCloudState=prepareCloudState(state);cloudConflictBlocked=false;cloudSaveRequested=false;localStorage.setItem(CLOUD_AUTO_KEY,'1');saveSession({access_token:'fixture',expires_at:9999999999});Object.defineProperty(navigator,'onLine',{value:false,configurable:true});return true;")
            for index,browser in enumerate((a,b)):
                if scenario=='distinct-morning':
                    # Morning transport is online; Orders cloud is unavailable until the
                    # profiles reconnect below. A verified network response while navigator
                    # is offline now correctly enters the refresh-required recovery path.
                    js(browser, f"Object.defineProperty(navigator,'onLine',{{value:true,configurable:true}});cloudAuth.cloudEnabled=()=>false;await window.auditIssue(320,{60 if index==0 else 70});cloudAuth.cloudEnabled=()=>true;Object.defineProperty(navigator,'onLine',{{value:false,configurable:true}});scheduleSave('fixture offline outbox');clearTimeout(saveTimer);saveTimer=null;await getCloudPending();return true;")
                else:
                    change="setCustomerFlag('AUDIT','paid',false);" if scenario=='reset-and-new-payment' and index==0 else "openDebtModal('AUDIT');document.getElementById('dPaid').value='partial';document.getElementById('dAddPayment').value='"+('20' if index==0 else '25')+"';saveDebt('AUDIT');"
                    js(browser, change+"clearTimeout(saveTimer);saveTimer=null;await getCloudPending();return true;")
            # The same CAS transport used by the normal two-computer suite. Each profile
            # has its own real LocalStorage/IndexedDB and uses the production merge/outbox.
            server=r"""
            readCloud=async()=>clone(window.fixtureHead);
            rpcSave=async(snapshot,expected)=>{if(expected!==window.fixtureHead.revision)return {r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}};window.fixtureHead={revision:expected+1,state:clone(snapshot)};return {r:{ok:true},row:clone(window.fixtureHead)}};
            Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
            await requestCloudSave('');return {head:window.fixtureHead,pending:await getCloudPending()};
            """
            first=js(a, 'window.fixtureHead={revision:10,state:prepareCloudState('+json.dumps(initial)+')};'+server)
            assert first['head']['revision']==11 and first['pending'] is None, first
            result=js(b, 'window.fixtureHead='+json.dumps(first['head'])+';'+server)
            assert result['head']['revision']==12 and result['pending'] is None, result
            debt=next(row for row in result['head']['state']['customerDebts'] if row['id']=='AUDIT')
            progress=js(b, "const {customerDebtProgressData}=await import('./assets/js/shared/customer-debt-progress.js');return customerDebtProgressData("+json.dumps(debt)+");")
            expected={'partial-payments':45,'reset-and-new-payment':25,'distinct-morning':100}[scenario]
            assert progress['paymentApplied']==expected and progress['remainingPayment']>=0, progress
            if scenario=='distinct-morning':
                assert progress['invoiceApplied']==100 and len(debt['debtProgress'])==4, debt
            print('PASS Morning two isolated computers with production CAS/outbox merge:', scenario)


def run():
    document_matrix()
    recovery_lock()
    cleanup_and_persistence()
    crash_snapshots()
    ownership()
    remotely_missing_debt()
    two_computers()


if __name__ == '__main__':
    run()
