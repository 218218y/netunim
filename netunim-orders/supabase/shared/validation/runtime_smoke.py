from pathlib import Path
import subprocess, tempfile, time, json, urllib.request, websocket, os, re, sys, shutil
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

def load_prepared(site):
    html=(site/'index.html').read_text(encoding='utf-8')
    stub = '<script>window.KUPA_SUPABASE_CONFIG={url:"https://example.invalid",publishableKey:"test"};window.ORDER_SUPABASE_CONFIG={url:"https://example.invalid",publishableKey:"test"};</script>'
    html=html.replace('<script src="supabase/config.js"></script>', stub)
    # Prevent service worker registration from touching blocked/local URLs; this does not alter app JS.
    html=html.replace("navigator.serviceWorker.register('./service-worker.js')", "Promise.resolve({scope:'smoke-test'})")
    return html

def wait_json(url, timeout=8):
    end=time.time()+timeout
    while time.time()<end:
        try:
            with urllib.request.urlopen(url,timeout=.5) as r: return json.load(r)
        except Exception: time.sleep(.1)
    raise RuntimeError('devtools unavailable')

def smoke(label, site, port):
    profile=tempfile.mkdtemp(prefix='chrome-smoke-')
    proc=subprocess.Popen([CHROME,'--headless=new','--no-sandbox','--disable-gpu',f'--remote-debugging-port={port}',f'--user-data-dir={profile}','--remote-allow-origins=*','--disable-background-networking','--disable-default-apps','--no-first-run','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        pages=wait_json(f'http://127.0.0.1:{port}/json/list')
        page=next(x for x in pages if x.get('type')=='page')
        ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=5)
        seq=0
        events=[]
        def call(method,params=None):
            nonlocal seq
            seq+=1; ident=seq
            ws.send(json.dumps({'id':ident,'method':method,'params':params or {}}))
            while True:
                msg=json.loads(ws.recv())
                if msg.get('id')==ident: return msg
                events.append(msg)
        call('Runtime.enable'); call('Page.enable'); call('Log.enable')
        shim = r'''(()=>{const makeStore=()=>{const m=new Map();return {getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};try{Object.defineProperty(window,'localStorage',{value:makeStore(),configurable:true})}catch(e){}try{Object.defineProperty(window,'sessionStorage',{value:makeStore(),configurable:true})}catch(e){}})()'''
        call('Runtime.evaluate',{'expression':shim})
        tree=call('Page.getFrameTree')['result']['frameTree']; fid=tree['frame']['id']
        html=load_prepared(site)
        call('Page.setDocumentContent',{'frameId':fid,'html':html})
        time.sleep(1.2)
        # Drain events briefly.
        ws.settimeout(.1)
        while True:
            try: events.append(json.loads(ws.recv()))
            except Exception: break
        ws.settimeout(5)
        errs=[]
        for e in events:
            m=e.get('method')
            p=e.get('params',{})
            if m=='Runtime.exceptionThrown':
                d=p.get('exceptionDetails',{}); ex=d.get('exception',{}); errs.append((d.get('text','exception')+' | '+str(ex.get('description') or ex.get('value') or '')+' @ '+str(d.get('url',''))+':'+str(d.get('lineNumber',''))))
            if m=='Log.entryAdded' and p.get('entry',{}).get('level')=='error': errs.append(p['entry'].get('text','log error'))
        # Inspect key globals and body state. Function names differ per app.
        expr="({ready:document.readyState,title:document.title,body:!!document.body,errors:[], shared:typeof saveSharedChecksToCloud==='function', normalize:typeof normalizeSharedChecks==='function'})"
        res=call('Runtime.evaluate',{'expression':expr,'returnByValue':True})
        val=res.get('result',{}).get('result',{}).get('value')
        # Ignore expected resource/network errors from about:blank. Any JS exception is a fail.
        serious=[x for x in errs if not any(t in str(x) for t in ['Failed to load resource','ERR_'])]
        print(label, json.dumps({'state':val,'exceptions':serious},ensure_ascii=False))
        if not val or not val.get('body') or not val.get('shared') or not val.get('normalize') or serious:
            return False
        return True
    finally:
        try: ws.close()
        except Exception: pass
        proc.terminate()
        try: proc.wait(timeout=3)
        except: proc.kill()
        shutil.rmtree(profile,ignore_errors=True)

allok=True
allok &= smoke('kupa',WORKSPACE/'netunim-kupa/site',9331)
allok &= smoke('orders',ORDERS/'site',9332)
raise SystemExit(0 if allok else 1)
