from pathlib import Path
import subprocess, tempfile, time, json, urllib.request, websocket, shutil, sys, os
ORDERS=Path(__file__).resolve().parents[3]
WORKSPACE=ORDERS.parent
CHROME=shutil.which('chromium') or shutil.which('chrome')
if not CHROME and os.name=='nt':
    CHROME=next((str(p) for p in (
        Path(os.environ.get('PROGRAMFILES',''))/'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('PROGRAMFILES(X86)',''))/'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('LOCALAPPDATA',''))/'Google/Chrome/Application/chrome.exe',
    ) if p.is_file()),None)
if not CHROME: raise SystemExit('chromium missing')

def wait_json(url, timeout=8):
    end=time.time()+timeout
    while time.time()<end:
        try:
            with urllib.request.urlopen(url,timeout=.5) as r: return json.load(r)
        except Exception: time.sleep(.1)
    raise RuntimeError('devtools unavailable')

def prepared(site):
    html=(site/'index.html').read_text(encoding='utf-8')
    stub = '<script>window.KUPA_SUPABASE_CONFIG={url:"https://example.invalid",publishableKey:"test"};window.ORDER_SUPABASE_CONFIG={url:"https://example.invalid",publishableKey:"test"};</script>'
    html=html.replace('<script src="supabase/config.js"></script>', stub)
    html=html.replace("navigator.serviceWorker.register('./service-worker.js')", "Promise.resolve({scope:'smoke-test'})")
    return html

def session(site,port):
    profile=tempfile.mkdtemp(prefix='chrome-finance-')
    proc=subprocess.Popen([CHROME,'--headless=new','--no-sandbox','--disable-gpu',f'--remote-debugging-port={port}',f'--user-data-dir={profile}','--remote-allow-origins=*','--disable-background-networking','--no-first-run','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    pages=wait_json(f'http://127.0.0.1:{port}/json/list'); page=next(x for x in pages if x.get('type')=='page')
    ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=5); seq=0; events=[]
    def call(method,params=None):
        nonlocal seq
        seq+=1; ident=seq; ws.send(json.dumps({'id':ident,'method':method,'params':params or {}}))
        while True:
            m=json.loads(ws.recv())
            if m.get('id')==ident:return m
            events.append(m)
    call('Runtime.enable');call('Page.enable')
    shim="""(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true});})()"""
    call('Runtime.evaluate',{'expression':shim}); fid=call('Page.getFrameTree')['result']['frameTree']['frame']['id'];call('Page.setDocumentContent',{'frameId':fid,'html':prepared(site)});time.sleep(.8)
    return profile,proc,ws,call

def run(label,site,port,expr,expected):
    profile=proc=ws=None
    try:
        profile,proc,ws,call=session(site,port)
        r=call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
        if 'exceptionDetails' in r.get('result',{}):
            print(label,'EXCEPTION',r['result']['exceptionDetails']);return False
        val=r.get('result',{}).get('result',{}).get('value')
        print(label,json.dumps(val,ensure_ascii=False))
        if val!=expected:
            print('EXPECTED',json.dumps(expected,ensure_ascii=False));return False
        return True
    finally:
        try: ws.close()
        except: pass
        try: proc.terminate();proc.wait(timeout=2)
        except: 
            try: proc.kill()
            except: pass
        if profile: shutil.rmtree(profile,ignore_errors=True)

kexpr=r"""(()=>{
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
 localStorage.removeItem(SHARED_CHECKS_PENDING_KEY);localStorage.setItem('kupa.shared.checks.cutover-r1-repair.v1','1');sharedChecksBootstrapActive=true;
 const repaired=mergeSharedChecks(repairRemote,[],repairRemote);out.bootRepairCount=repaired.checks.length;out.bootRepairApplied=repaired.repairedEmptyBootstrap;out.staleMarkerIgnored=repaired.repairedEmptyBootstrap;
 const laterDelete=mergeSharedChecks(repairRemote,[],repairRemote);out.postRepairDeleteCount=laterDelete.checks.length;
 return out;
})()"""
kexpected={'deposit':1100,'returnAfterSnapshot':900,'amountChangeThenDelete':1000,'pendingDeposit':1100,'pendingReturn':900,'bootRepairCount':1,'bootRepairApplied':True,'staleMarkerIgnored':True,'postRepairDeleteCount':0}

oexpr=r"""(()=>{
 const ev=(seq,delta,id='C1')=>({seq,at:'2026-08-26T10:01:00Z',delta,kind:'check_effect_delta',checkId:id});
 state.checks=[];checksCloudBase=[];checksBankEvents=[ev(11,100),ev(12,-100)];
 const k={bank:{currentBalance:1000,updatedAt:'2026-08-26T10:00:00Z',asOfDate:'2026-08-26',snapshotSeq:11,adjustments:[]},credits:[],expenses:[],cash:[]};
 const a=computeKupaNetReadout(k).bank;
 state.checks=[{id:'C1',amount:100,status:'הופקד - במעקב',dueDate:'2026-09-01'}];checksCloudBase=[{id:'C1',amount:100,status:'בקופה',dueDate:'2026-09-01'}];checksBankEvents=[];
 const b=computeKupaNetReadout({bank:{currentBalance:1000,updatedAt:'2026-08-26T10:00:00Z',asOfDate:'2026-08-26',snapshotSeq:10,adjustments:[]},credits:[],expenses:[],cash:[]}).bank;
 return {returnAfterSnapshot:a,pendingDeposit:b};
})()"""
oexpected={'returnAfterSnapshot':900,'pendingDeposit':1100}

ok=run('kupa-financial',WORKSPACE/'netunim-kupa/site',9341,kexpr,kexpected)
ok=run('orders-financial',ORDERS/'site',9342,oexpr,oexpected) and ok
raise SystemExit(0 if ok else 1)
