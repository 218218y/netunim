"""Completed search/preview privacy under real same-origin auth storage events."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;
 const {createCloudAuth}=await import('./assets/js/cloud/auth.js');
 const {composeDocumentSearch}=await import('./assets/js/shared/document-search-composition.js');
 const {createGlobalDocumentSearch}=await import('./assets/js/shared/global-document-search.js');
 const app=__APP__,auth=createCloudAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
 const store=app==='kupa'?auth.storeSupaSession:auth.saveSession;
 const credentials=id=>({user:{id},access_token:'synthetic-'+id,expires_at:9999999999});
 store(credentials('A'));
 const phase=__PHASE__,image=phase==='cross-tab',revoked=[],urls=[],createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{const url=createUrl(blob);urls.push(url);return url};URL.revokeObjectURL=url=>{revoked.push(url);revokeUrl(url)};
 const requests=[],source=composeDocumentSearch({accountScope:()=>auth.getAccountScope(),subscribeAccountScope:auth.subscribeAccountScope,
  supaFetch:async()=>new Response(JSON.stringify({access_token:'token-'+auth.getAccountScope().owner,expires_in:3600})),
  drivePlatform:{userAgent:'Android privacy fixture',clock:{now:()=>0},browser:{navigate:()=>{throw Error('unexpected external navigation')}},fetchRequest:async(url,options)=>{
   const owner=options.headers.Authorization.slice(13);requests.push(owner);
   const row={id:'private-file',name:'private-'+owner+(image?'.png':'.txt'),mimeType:image?'image/png':'text/plain',size:'20',webViewLink:'https://drive.google.com/file/d/private-'+owner+'/view'};
   const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII='),value=>value.charCodeAt(0));
   return new URL(url).searchParams.get('alt')==='media'?new Response(image?bytes:'private preview '+owner):new Response(JSON.stringify(String(url).includes('/files?')?{files:[row]}:row));
  }}});
 for(const id of ['globalSearchBackdrop','globalSearchButton']){const node=document.getElementById(id);node.replaceWith(node.cloneNode(true))}
 const ui=createGlobalDocumentSearch({documentBridge:source,siteSearch:()=>({total:0,groups:[]})});ui.bind();
 const results=document.getElementById('globalSearchResults'),preview=document.getElementById('globalSearchPreviewBody');
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 const wait=async(predicate,message)=>{const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw Error(message);await frame()}};
 async function show(owner){document.getElementById('globalSearchInput').value='private';ui.setFilter('files');ui.open();await wait(()=>results.textContent.includes('private-'+owner+(image?'.png':'.txt')),'search did not settle');results.querySelector('[data-document-result-id]').click();await wait(()=>image?preview.querySelector('img[src^="blob:"]'):preview.textContent.includes('private preview '+owner),'preview did not settle')}
 await show('A');
 // Independent native IDB data must survive presentation cleanup byte-for-byte.
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('document-privacy-fixture',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 await new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({id:'retained-event',body:'unchanged pending body'},'event');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
 const read=()=>new Promise((resolve,reject)=>{const request=db.transaction('pending').objectStore('pending').get('event');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),before=JSON.stringify(await read());
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),journal=createStorageJournalDb();
 const readBusiness=async()=>JSON.stringify([await journal.load('local:'+app),await journal.load('local:shared-checks')]),businessBefore=await readBusiness();
 globalThis.privacyFixture={auth,store,credentials,ui,source,requests,show,wait,before,read,readBusiness,businessBefore,urls,revoked,createUi:()=>createGlobalDocumentSearch({documentBridge:source,siteSearch:()=>({total:0,groups:[]})}),key:app==='kupa'?'kupa.supabase.session.v1':'orders.supabase.session.v1'};
 return {displayed:true};
})()"""

VERIFY = r"""(async()=>{
 const f=privacyFixture,results=document.getElementById('globalSearchResults'),preview=document.getElementById('globalSearchPreviewBody');
 await f.wait(()=>!results.textContent.includes('private-A.')&&!preview.textContent.includes('private preview A'),'completed former-account search/preview remained visible');
 if(results.querySelector('[data-document-result-id]')||preview.querySelector('a[href]'))throw Error('former-account action link retained');
 if(preview.querySelector('img[src^="blob:"]')||f.urls.some(url=>!f.revoked.includes(url)))throw Error('former-account Blob preview retained');
 if(JSON.stringify(await f.read())!==f.before)throw Error('display cleanup changed native pending data');
 if(await f.readBusiness()!==f.businessBefore)throw Error('display cleanup changed business Journal/Shared records');
 const count=f.requests.length;try{await f.source.search('private');throw Error('logout performed a search')}catch(error){if(error.code!=='google_drive_cloud_auth_required')throw error}
 if(f.requests.length!==count)throw Error('logout contacted Drive with an old token');
 const owner=f.auth.getAccountScope().owner;f.store(f.credentials('B'));await f.show('B');
 if(results.textContent.includes('private-A.')||f.requests.at(-1)!=='B')throw Error('new account reused A result/cache');
 f.ui.bind();f.ui.dispose();if(f.ui.dispose()!==false)throw Error('dispose not idempotent');
 if(results.querySelector('[data-document-result-id]')||preview.querySelector('img[src^="blob:"]'))throw Error('dispose retained a document');
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,live=new Set();
 EventTarget.prototype.addEventListener=function(type,fn,options){if(this===window||this===document)live.add(fn);return add.call(this,type,fn,options)};
 EventTarget.prototype.removeEventListener=function(type,fn,options){if(this===window||this===document)live.delete(fn);return remove.call(this,type,fn,options)};
 try{for(let i=0;i<100;i++){const ui=f.createUi();ui.bind();ui.bind();ui.dispose();if(live.size)throw Error('search/auth browser listener retained after disposal: '+[...live].map(fn=>String(fn).slice(0,160)).join(' | '))}}finally{EventTarget.prototype.addEventListener=add;EventTarget.prototype.removeEventListener=remove}
 return {cleared:true,pendingRetained:true,businessRetained:true,owner,newOwner:'B',revoked:f.revoked.length,resourceCycles:100};
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--app', choices=('kupa','orders'), action='append')
parser.add_argument('--phase', choices=('local','cross-tab'), action='append')
parser.add_argument('--baseline',action='store_true')
args=parser.parse_args()
for app in args.app or ('kupa','orders'):
    for phase in args.phase or ('local','cross-tab'):
        with BrowserSession(ROOT/f'netunim-{app}/site', f'{app}-document-privacy-{phase}',auto_navigate=False) as browser:
            if args.baseline:
                for path in ('cloud/auth.js','shared/authenticated-account-scope.js','shared/document-search-composition.js','shared/global-document-search.js'):
                    content=subprocess.check_output(['git','show',f'ec013b1a269d300d14e5f030965910e7d9c104ff:netunim-{app}/site/assets/js/{path}'],cwd=ROOT)
                    prepared=browser.tmp/f'site/assets/js/{path}'
                    trailer=prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                    if len(trailer)>1:
                        content+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                    prepared.write_bytes(content)
            browser._navigate()
            browser.evaluate(SETUP.replace('__APP__',json.dumps(app)).replace('__PHASE__',json.dumps(phase)),timeout=30)
            if phase=='local':
                browser.evaluate('privacyFixture.store(null); true')
            else:
                with browser.second_tab():
                    browser.evaluate("localStorage.removeItem("+json.dumps('kupa.supabase.session.v1' if app=='kupa' else 'orders.supabase.session.v1')+"); true")
            result=browser.evaluate(VERIFY,timeout=15)
            assert result['owner'] is None,result
            assert not browser.drain_serious_errors()
            print(f'PASS {app} completed document {phase} privacy: {json.dumps(result)}',flush=True)
