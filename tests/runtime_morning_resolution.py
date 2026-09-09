"""A/B handover: production cloud refresh, durable Recovery and explicit UI decisions."""
import json
from browser_harness import BrowserSession, ROOT
from runtime_morning_audit import seed, js, reload, SETUP


class StartupBrowser(BrowserSession):
    def _prepare_site(self):
        super()._prepare_site()
        # Install fault injection only in the disposable instrumented copy, before boot.
        path=self.tmp/'site/assets/js/main.js'
        source=path.read_text(encoding='utf8')
        fixture=r"""
if(localStorage.getItem('audit.startup')){
  const fixture=JSON.parse(localStorage.getItem('audit.startup'));
  globalThis.startupCloudReads=0;
  globalThis.startupCloudGate=new Promise(resolve=>{globalThis.releaseStartupCloud=resolve});
  cloudAuth.loadSession=()=>({access_token:'fixture',expires_at:9999999999});
  cloudAuth.cloudEnabled=()=>true;cloudAuth.ensureSyncCapabilities=async()=>true;
  uiBackup.resumeIncompleteRestore=async()=>false;
  // Model a failed initial hydration. The real appReady Morning timer still runs.
  uiCloud.openCloud=async()=>false;
  domainsCalendarController.start=()=>{};domainsFinanceController.startAutoSync=()=>{};
  domainsBankCache.refreshKupaReadout=async()=>true;syncChecks.syncSharedChecksFromCloud=async()=>true;
  cloudTransport.readCloud=async()=>{globalThis.startupCloudReads++;await globalThis.startupCloudGate;return structuredClone(fixture.head)};
  cloudTransport.rpcSave=async(snapshot,expected)=>({r:{ok:true},row:{revision:expected+1,state:structuredClone(snapshot)}});
  cloudAuth.supaFetch=async()=>new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'sandbox',operation:fixture.operation}),{headers:{'Content-Type':'application/json'}});
}
"""
        import re
        source,count=re.subn(r'(export (?:const|let) appReady=)',lambda match:fixture+'\n'+match.group(1),source)
        assert count==1
        path.write_text(source,encoding='utf8')


def startup_barrier():
    with StartupBrowser(ROOT/'netunim-orders/site','morning-startup-barrier') as a:
        head=pending(a)
        remote=json.loads(json.dumps(head));remote['revision']+=1
        remote['state']['customerDebts'][0]['debtProgress']=[{'id':'B-PAY','kind':'payment','action':'add','amount':30,'source':'manual'}]
        js(a,'localStorage.setItem("audit.startup",JSON.stringify({head:'+json.dumps(remote)+",operation:{...window.auditServer.operation,state:'created',verified_at:new Date().toISOString()}}));return true;")
        a._navigate();a.evaluate('appReady.then(()=>true)')
        result=js(a,r"""
        await new Promise(r=>setTimeout(r,900));
        const {customerDebtProgressData}=await import('./assets/js/shared/customer-debt-progress.js');
        const before=customerDebtProgressData(state.customerDebts.find(d=>d.id==='AUDIT')).paymentApplied;
        if(!globalThis.startupCloudReads||before!==0||!localStorage.getItem('orders.morning.pending-issuance.v1'))throw new Error('startup allocated before successful GET');
        globalThis.releaseStartupCloud();
        for(let i=0;i<200&&!document.getElementById('morningRecoveryPayment');i++)await new Promise(r=>setTimeout(r,10));
        const current=customerDebtProgressData(state.customerDebts.find(d=>d.id==='AUDIT'));
        if(current.paymentApplied!==30||document.getElementById('morningRecoveryPayment')?.checked!==false)throw new Error('startup ignored changed financial snapshot');
        return true;
        """)
        assert result
        print('PASS actual startup/appReady timer: failed hydration then delayed GET cannot allocate until refresh completes')


def pending(a,kind=320):
    seed(a)
    js(a,f"window.auditSetServer({{uncertain:true}});await window.auditIssue({kind},30);await requestCloudSave('fixture baseline');clearTimeout(saveTimer);saveTimer=null;return true;")
    return a.evaluate('({revision:cloudRevision,state:prepareCloudState(state)})')


def remote_edit(b,head,change):
    seed(b)
    js(b,'state=normalizeState('+json.dumps(head['state'])+');cloudRevision='+str(head['revision'])+';lastCloudState=prepareCloudState(state);window.auditCloudHead='+json.dumps(head)+';'+change+";await requestCloudSave('computer B');clearTimeout(saveTimer);saveTimer=null;return true;")
    return b.evaluate('window.auditCloudHead')


def resume(a,head,do_reload=True):
    if do_reload:
        reload(a)
    js(a,'window.auditCloudHead='+json.dumps(head)+";window.auditSetServer({operation:{...window.auditServer.operation,state:'created',verified_at:new Date().toISOString()}});return true;")


def choose(a,payment,invoice):
    return js(a,f"""
    const p=document.getElementById('morningRecoveryPayment'),i=document.getElementById('morningRecoveryInvoice');
    if(p){{p.checked={str(payment).lower()};p.dispatchEvent(new Event('change',{{bubbles:true}}))}}
    if(i){{i.checked={str(invoice).lower()};i.dispatchEvent(new Event('change',{{bubbles:true}}))}}
    document.querySelector('[data-action="morning-recovery-confirm"]').click();
    await window.auditWait(()=>!localStorage.getItem('orders.morning.pending-issuance.v1'));
    return {{progress:await window.auditProgress(),entries:window.auditDebt().debtProgress,reads:window.auditCloudReads}};
    """)


def handover():
    with BrowserSession(ROOT/'netunim-orders/site','morning-resolution-A') as a, BrowserSession(ROOT/'netunim-orders/site','morning-resolution-B') as b:
        head=pending(a)
        head=remote_edit(b,head,"openDebtModal('AUDIT');document.getElementById('dPaid').value='partial';document.getElementById('dAddPayment').value='30';saveDebt('AUDIT')")
        resume(a,head)
        js(a,r"""
        const result=await recoverPendingMorningOperation();
        window.auditAssert(result.result?.reason==='decision-required','same B payment not held for explicit decision '+JSON.stringify(result));
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&window.auditDebt().debtProgress.length===1,'automatic double deduction');
        window.auditAssert(!document.getElementById('morningRecoveryPayment').checked&&document.getElementById('morningRecoveryInvoice').checked,'independent safe defaults for 320');
        window.auditAssert(document.getElementById('morningRecoveryDecision').textContent.includes('בזמן ההפקה')&&document.getElementById('morningRecoveryDecision').textContent.includes('30'),'missing financial comparison');
        document.getElementById('morningRecoveryInvoice').checked=false;document.getElementById('morningRecoveryInvoice').dispatchEvent(new Event('change',{bubbles:true}));
        window.auditAssert(JSON.parse(localStorage.getItem('orders.morning.pending-issuance.v1')).resolution.applyInvoice===false,'draft choice not durable');return true;
        """)
        resume(a,head)
        js(a,"await recoverPendingMorningOperation();window.auditAssert(!document.getElementById('morningRecoveryInvoice').checked,'reload lost draft choice');return true;")
        result=choose(a,False,True)
        assert result['progress']['paymentApplied']==30 and result['progress']['invoiceApplied']==30, result
        assert len(result['entries'])==2 and result['entries'][0]['source']=='manual',result
        js(a,"await recoverPendingMorningOperation();window.auditAssert(window.auditDebt().debtProgress.length===2,'post-decision replay duplicated event');return true;")
        print('PASS A/B same payment: refresh detects 30 on B; persisted draft survives reload; explicit invoice-only keeps payment 30')
    with BrowserSession(ROOT/'netunim-orders/site','morning-additional-A') as a, BrowserSession(ROOT/'netunim-orders/site','morning-additional-B') as b:
        head=pending(a)
        head=remote_edit(b,head,"openDebtModal('AUDIT');document.getElementById('dPaid').value='partial';document.getElementById('dAddPayment').value='20';saveDebt('AUDIT')")
        resume(a,head)
        js(a,"await recoverPendingMorningOperation();window.auditAssert((await window.auditProgress()).paymentApplied===20,'additional payment applied before approval');return true;")
        result=choose(a,True,True)
        assert result['progress']['paymentApplied']==50 and result['progress']['invoiceApplied']==30 and len(result['entries'])==3,result
        print('PASS A/B distinct payment: explicit approval keeps B payment 20 and adds Morning 30 once')
    with BrowserSession(ROOT/'netunim-orders/site','morning-metadata-A') as a, BrowserSession(ROOT/'netunim-orders/site','morning-metadata-B') as b:
        head=pending(a)
        head=remote_edit(b,head,"openDebtModal('AUDIT');document.getElementById('dNote').value='B note';document.getElementById('dSupplied').value='true';saveDebt('AUDIT')")
        resume(a,head)
        js(a,"const r=await recoverPendingMorningOperation();window.auditAssert(r.ok&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'metadata caused false positive '+JSON.stringify(r));window.auditAssert(window.auditDebt().note==='B note'&&window.auditDebt().supplied&&(await window.auditProgress()).paymentApplied===30,'metadata or Morning lost');return true;")
        print('PASS A/B note and supplied only: refreshed metadata preserved; Morning applies automatically')


def refresh_barrier():
    for trigger in ['manual','online','visibilitychange']:
        with BrowserSession(ROOT/'netunim-orders/site','morning-barrier-'+trigger) as a:
            head=pending(a)
            # Persist and reload A before serving the updated remote head.
            remote=json.loads(json.dumps(head));remote['revision']+=1
            remote['state']['customerDebts'][0]['debtProgress']=[{'id':'B-PAY','kind':'payment','action':'add','amount':30,'source':'manual','createdAt':'2026-09-09T10:00:00.000Z'}]
            resume(a,remote)
            js(a,r"""
            window.auditCloudReadGate=new Promise(resolve=>{window.auditReleaseCloud=resolve});
            cloudAuth.loadSession=()=>({access_token:'fixture',expires_at:9999999999});
            syncChecks.pollSharedChecks=async()=>true;
            domainsBankCache.refreshKupaReadout=async()=>true;
            return true;
            """)
            if trigger=='manual':
                js(a,"window.auditRecovery= recoverPendingMorningOperation();return true;")
            elif trigger=='online':
                js(a,"window.dispatchEvent(new Event('online'));return true;")
            else:
                js(a,"Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));return true;")
            # Wait past the actual startup/online/visibility timers while the GET is unresolved.
            js(a,r"""
            await new Promise(r=>setTimeout(r,900));
            window.auditAssert(window.auditCloudReads>0,'cloud GET never started');
            window.auditAssert((await window.auditProgress()).paymentApplied===0&&!!localStorage.getItem('orders.morning.pending-issuance.v1'),'Recovery timer bypassed awaited cloud GET');
            window.auditReleaseCloud();window.auditCloudReadGate=null;
            await window.auditWait(()=>!!document.getElementById('morningRecoveryPayment'));
            window.auditAssert((await window.auditProgress()).paymentApplied===30&&!document.getElementById('morningRecoveryPayment').checked,'late GET did not compare B payment');return true;
            """)
            print('PASS real cloud GET completion barrier after reload; trigger:',trigger)
    with BrowserSession(ROOT/'netunim-orders/site','morning-cloud-outage') as a:
        head=pending(a);resume(a,head)
        js(a,r"""
        window.auditCloudFail=true;
        const result=await recoverPendingMorningOperation();
        window.auditAssert(result.result?.reason==='cloud-refresh-pending'&&(await window.auditProgress()).paymentApplied===0,'cloud failure applied debt');
        window.auditAssert(!!localStorage.getItem('orders.morning.pending-issuance.v1'),'cloud failure cleared recovery');
        window.auditCloudFail=false;await recoverPendingMorningOperation();
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'cloud return failed recovery');return true;
        """)
        print('PASS unavailable cloud: no allocation or cleanup; successful later GET resumes')


def legacy_and_document_types():
    for kind in [305,400,320]:
        with BrowserSession(ROOT/'netunim-orders/site','morning-legacy-'+str(kind)) as a:
            head=pending(a,kind)
            js(a,"const key='orders.morning.pending-issuance.v1',record=JSON.parse(localStorage.getItem(key));delete record.financialSnapshot;localStorage.setItem(key,JSON.stringify(record));return true;")
            resume(a,head)
            js(a,f"""
            await recoverPendingMorningOperation();
            window.auditAssert((await window.auditProgress()).paymentApplied===0&&(await window.auditProgress()).invoiceApplied===0,'legacy auto applied');
            const p=document.getElementById('morningRecoveryPayment'),i=document.getElementById('morningRecoveryInvoice');
            window.auditAssert(!!p==={str(kind!=305).lower()}&&!!i==={str(kind!=400).lower()},'document-specific choices');
            window.auditAssert((!p||!p.checked)&&(!i||!i.checked),'legacy unsafe defaults');return true;
            """)
            result=choose(a,kind!=305,kind!=400)
            assert result['progress']['paymentApplied']==(0 if kind==305 else 30),result
            assert result['progress']['invoiceApplied']==(0 if kind==400 else 30),result
            print('PASS legacy no snapshot requires explicit approval, supported choices only:',kind)


def durable_approval():
    with BrowserSession(ROOT/'netunim-orders/site','morning-approved-reload') as a:
        head=pending(a);remote=json.loads(json.dumps(head));remote['revision']+=1
        remote['state']['customerDebts'][0]['debtProgress']=[{'id':'B-PAY','kind':'payment','action':'add','amount':30,'source':'manual'}]
        resume(a,remote)
        js(a,r"""
        await recoverPendingMorningOperation();
        window.realApplyMorning=domainsCustomers.editor.applyVerifiedMorningDocument;
        domainsCustomers.editor.applyVerifiedMorningDocument=()=>({changed:false,reason:'simulated-crash-before-apply'});
        await confirmMorningRecoveryChoice(document.querySelector('[data-action="morning-recovery-confirm"]'));
        const stored=JSON.parse(localStorage.getItem('orders.morning.pending-issuance.v1'));
        window.auditAssert(!!stored.resolution.confirmedAt&&!stored.resolution.applyPayment&&stored.resolution.applyInvoice,'approval not durably stored before application');
        window.auditAssert(window.auditDebt().debtProgress.length===1,'crash fixture applied event');return true;
        """)
        resume(a,remote)
        js(a,r"""
        await recoverPendingMorningOperation();
        window.auditAssert((await window.auditProgress()).paymentApplied===30&&(await window.auditProgress()).invoiceApplied===30,'persisted approval changed after reload');
        await recoverPendingMorningOperation();window.auditAssert(window.auditDebt().debtProgress.length===2,'approved replay duplicated');return true;
        """)
        print('PASS confirmed invoice-only decision survives crash before application and reload; operation replay remains idempotent')


def decision_races():
    with BrowserSession(ROOT/'netunim-orders/site','morning-decision-race') as a:
        head=pending(a);remote=json.loads(json.dumps(head));remote['revision']+=1
        remote['state']['customerDebts'][0]['amount']=120
        resume(a,remote)
        js(a,r"""
        await recoverPendingMorningOperation();
        window.auditAssert(!document.getElementById('morningRecoveryPayment').checked&&!document.getElementById('morningRecoveryInvoice').checked,'amount change must default both sides off');
        document.getElementById('morningRecoveryPayment').checked=true;
        window.auditCloudHead.state.customerDebts[0].amount=150;window.auditCloudHead.revision++;
        await confirmMorningRecoveryChoice(document.querySelector('[data-action="morning-recovery-confirm"]'));
        const record=JSON.parse(localStorage.getItem('orders.morning.pending-issuance.v1'));
        window.auditAssert(!record.resolution.confirmedAt&&(await window.auditProgress()).paymentApplied===0,'stale decision applied after another cloud change');
        window.auditAssert(!document.getElementById('morningRecoveryPayment').checked,'changed-again amount did not reset safe defaults');
        const set=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='orders.morning.pending-issuance.v1')throw new Error('fixture decision storage failure');return set.call(this,key,value)};
        await confirmMorningRecoveryChoice(document.querySelector('[data-action="morning-recovery-confirm"]'));
        window.auditAssert((await window.auditProgress()).paymentApplied===0&&!!localStorage.getItem('orders.morning.pending-issuance.v1'),'failed decision save applied debt');
        Storage.prototype.setItem=set;return true;
        """)
        print('PASS decision race: changed-again cloud requires fresh approval; failed decision persistence never applies')


def disconnected_create_response():
    with BrowserSession(ROOT/'netunim-orders/site','morning-delayed-create') as a:
        seed(a)
        js(a,r"""
        scheduleSave('fixture');await requestCloudSave('fixture');clearTimeout(saveTimer);saveTimer=null;
        window.auditCloudHead={revision:cloudRevision,state:prepareCloudState(state)};
        const transport=cloudAuth.supaFetch;
        cloudAuth.supaFetch=async(path,options)=>{
          if(JSON.parse(options.body).action==='create'){
            window.auditCreateStarted=true;await new Promise(resolve=>{window.auditReleaseCreate=resolve});
          }
          return transport(path,options);
        };
        window.auditIssuing=window.auditIssue(320,30);await window.auditWait(()=>window.auditCreateStarted);
        window.dispatchEvent(new Event('offline'));
        window.auditCloudHead.revision++;
        window.auditCloudHead.state.customerDebts[0].debtProgress=[{id:'B-manual',kind:'payment',action:'add',amount:30,source:'manual'}];
        window.auditReleaseCreate();await window.auditIssuing;
        window.auditAssert(window.auditCloudReads>0&&(await window.auditProgress()).paymentApplied===30,'late verified create bypassed refresh after disconnection');
        window.auditAssert(!!localStorage.getItem('orders.morning.pending-issuance.v1')&&document.getElementById('morningRecoveryPayment')?.checked===false,'late create did not require explicit decision');return true;
        """)
        print('PASS delayed verified create after disconnection uses cloud refresh and explicit decision, not immediate allocation')


def approved_replay_after_cleanup_failure():
    with BrowserSession(ROOT/'netunim-orders/site','morning-approved-cleanup') as a:
        head=pending(a);remote=json.loads(json.dumps(head));remote['revision']+=1
        remote['state']['customerDebts'][0]['debtProgress']=[{'id':'B-PAY','kind':'payment','action':'add','amount':30,'source':'manual'}]
        resume(a,remote)
        js(a,r"""
        await recoverPendingMorningOperation();
        const remove=Storage.prototype.removeItem;
        Storage.prototype.removeItem=function(key){if(key==='orders.morning.pending-issuance.v1')throw new Error('fixture cleanup failure');return remove.call(this,key)};
        await confirmMorningRecoveryChoice(document.querySelector('[data-action="morning-recovery-confirm"]'));
        window.auditAssert(window.auditDebt().debtProgress.length===2&&!!localStorage.getItem('orders.morning.pending-issuance.v1'),'approved effect/cleanup fixture missing');
        await requestCloudSave('fixture approved effect');clearTimeout(saveTimer);saveTimer=null;
        Storage.prototype.removeItem=remove;return true;
        """)
        head=a.evaluate('window.auditCloudHead')
        resume(a,head)
        js(a,r"""
        const result=await recoverPendingMorningOperation();
        window.auditAssert(result.ok&&!localStorage.getItem('orders.morning.pending-issuance.v1'),'own approved event caused false financial conflict on reload '+JSON.stringify(result));
        const p=await window.auditProgress();window.auditAssert(p.paymentApplied===30&&p.invoiceApplied===30&&window.auditDebt().debtProgress.length===2,'approved replay added or lost an event');return true;
        """)
        print('PASS approved decision + cleanup failure + cloud save + reload: own operation IDs replay without false conflict or duplicate')


def run():
    handover()
    refresh_barrier()
    legacy_and_document_types()
    durable_approval()
    startup_barrier()
    decision_races()
    disconnected_create_response()
    approved_replay_after_cleanup_failure()


if __name__=='__main__':
    run()
