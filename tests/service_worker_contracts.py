from __future__ import annotations

from pathlib import Path
import ast
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APPS = {
    "kupa": ROOT / "netunim-kupa/site",
    "orders": ROOT / "netunim-orders/site",
}
errors = []


def ok(condition, message):
    if condition:
        print("PASS", message)
    else:
        print("FAIL", message)
        errors.append(message)




def runtime_probe(sw_path: Path):
    probe = r"""
const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(process.argv[1],'utf8');
(async()=>{
  const handlers={},calls={open:[],addAll:[],put:[],deleted:[],claim:0,skip:0,network:0};
  const cache={
    addAll:async items=>{calls.addAll.push([...items])},
    put:async(req,res)=>{calls.put.push(typeof req==='string'?req:req.url||'request')}
  };
  const context={
    console,URL,Promise,Error,setTimeout,clearTimeout,
    self:{location:{origin:'https://app.test'},clients:{claim:async()=>{calls.claim++}},skipWaiting:async()=>{calls.skip++},addEventListener:(name,fn)=>{handlers[name]=fn}},
    caches:{
      open:async name=>{calls.open.push(name);return cache},
      keys:async()=>['old-cache','current-placeholder'],
      delete:async key=>{calls.deleted.push(key);return true},
      match:async()=>null
    },
    fetch:async request=>{calls.network++;return {ok:true,tag:'network',clone(){return {ok:true,tag:'clone'}}}}
  };
  vm.createContext(context);vm.runInContext(source,context,{filename:process.argv[1]});
  const event=extra=>{const waits=[];let response=null;return Object.assign({waitUntil:p=>waits.push(Promise.resolve(p)),respondWith:p=>{response=Promise.resolve(p)},_waits:waits,_response:()=>response},extra)};
  const install=event({});handlers.install(install);await Promise.all(install._waits);
  const currentCache=calls.open[0];context.caches.keys=async()=>['old-cache',currentCache];
  const activate=event({});handlers.activate(activate);await Promise.all(activate._waits);
  const onlineReq={method:'GET',url:'https://app.test/index.html',mode:'navigate'};
  const online=event({request:onlineReq});handlers.fetch(online);const onlineRes=await online._response();await Promise.all(online._waits);
  context.fetch=async()=>{calls.network++;throw new Error('offline')};
  const cached={tag:'cached'};const cachedReq={method:'GET',url:'https://app.test/icon.png',mode:'no-cors'};
  context.caches.match=async key=>key===cachedReq?cached:null;
  const offlineCached=event({request:cachedReq});handlers.fetch(offlineCached);const cachedRes=await offlineCached._response();
  const navReq={method:'GET',url:'https://app.test/other',mode:'navigate'};const fallback={tag:'fallback'};
  context.caches.match=async key=>key==='./index.html'?fallback:null;
  const offlineNav=event({request:navReq});handlers.fetch(offlineNav);const fallbackRes=await offlineNav._response();
  const cross=event({request:{method:'GET',url:'https://other.test/a',mode:'no-cors'}});handlers.fetch(cross);
  const post=event({request:{method:'POST',url:'https://app.test/a',mode:'same-origin'}});handlers.fetch(post);
  process.stdout.write(JSON.stringify({
    installShell:calls.addAll[0]||[],skip:calls.skip,claim:calls.claim,
    deleted:calls.deleted,online:onlineRes&&onlineRes.tag,putCount:calls.put.length,
    cached:cachedRes&&cachedRes.tag,fallback:fallbackRes&&fallbackRes.tag,
    crossResponded:!!cross._response(),postResponded:!!post._response()
  }));
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", probe, str(sw_path)], capture_output=True, text=True)
    if result.returncode != 0:
        return None, result.stderr.strip() or result.stdout.strip()
    try:
        return json.loads(result.stdout), None
    except Exception as exc:
        return None, f"invalid runtime probe output: {exc}: {result.stdout!r}"

def parse_shell(text: str):
    match = re.search(r"const\s+SHELL\s*=\s*(\[[^;]+\])\s*;", text, re.S)
    if not match:
        return None
    # JavaScript shell literals here are intentionally plain quoted strings and
    # therefore compatible with Python literal parsing.
    return ast.literal_eval(match.group(1))


for label, site in APPS.items():
    sw_path = site / "service-worker.js"
    text = sw_path.read_text(encoding="utf-8")
    shell = parse_shell(text)
    ok(isinstance(shell, list) and bool(shell), f"{label}: service worker declares a shell list")
    if not shell:
        continue
    required = {
        "./",
        "./index.html",
        "./assets/app.css",
        "./assets/app.js",
        "./manifest.webmanifest",
        "./supabase/config.js",
        "./favicon.ico",
        "./favicon-16x16.png",
        "./favicon-32x32.png",
        "./apple-touch-icon.png",
        "./android-chrome-192x192.png",
        "./android-chrome-512x512.png",
    }
    ok(set(shell) == required, f"{label}: shell contains exactly the expected public app files")
    for item in shell:
        if item == "./":
            continue
        relative = item[2:] if item.startswith("./") else item
        ok((site / relative).is_file(), f"{label}: cached shell file exists: {relative}")
    forbidden_markers = ("data/", "backups/", ".json", ".csv", ".sql", ".env", "orders-data", "kupa-data")
    ok(not any(any(marker in item.lower() for marker in forbidden_markers) for item in shell),
       f"{label}: service worker shell does not cache business data or source-only files")
    ok("event.request.method!=='GET'" in text or 'event.request.method!=="GET"' in text,
       f"{label}: non-GET requests bypass cache handling")
    ok("url.origin!==self.location.origin" in text,
       f"{label}: cross-origin requests bypass cache handling")
    ok("event.request.mode==='navigate'" in text and "caches.match('./index.html')" in text,
       f"{label}: offline navigation falls back to cached index.html")
    ok("keys.filter" in text and "caches.delete" in text,
       f"{label}: activation removes obsolete caches")
    # Both apps deliberately use network-first for same-origin GETs. This means a
    # deployment can refresh static files even if the cache name is not manually bumped.
    fetch_pos = text.find("event.respondWith")
    network_pos = text.find("fetch(event.request)", fetch_pos)
    cache_pos = text.find("caches.match(event.request)", fetch_pos)
    ok(fetch_pos >= 0 and network_pos >= 0 and (cache_pos < 0 or network_pos < cache_pos),
       f"{label}: normal same-origin GET path is network-first")

    probe, probe_error = runtime_probe(sw_path)
    ok(probe_error is None, f"{label}: service worker executes in isolated runtime probe")
    if probe_error:
        print("  ", probe_error)
    else:
        ok(probe.get("installShell") == shell, f"{label}: install actually pre-caches the declared shell")
        ok(probe.get("skip") == 1 and probe.get("claim") == 1, f"{label}: install/activate take control immediately")
        ok(probe.get("deleted") == ["old-cache"], f"{label}: activate deletes only obsolete caches")
        ok(probe.get("online") == "network" and probe.get("putCount", 0) >= 1, f"{label}: online GET returns network response and refreshes cache")
        ok(probe.get("cached") == "cached", f"{label}: offline cached asset is returned")
        ok(probe.get("fallback") == "fallback", f"{label}: offline uncached navigation returns index fallback")
        ok(not probe.get("crossResponded") and not probe.get("postResponded"), f"{label}: cross-origin and non-GET requests are untouched")

if errors:
    print("\nERRORS", len(errors))
    for item in errors:
        print("-", item)
    sys.exit(1)
print("\nALL SERVICE WORKER CONTRACTS PASSED")
