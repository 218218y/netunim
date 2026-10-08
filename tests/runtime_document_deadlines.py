"""Actual local client -> source -> Global Search deadlines in both app DOMs."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const {createDocumentBridgeClient}=await import('./assets/js/shared/document-bridge-client.js');
 const {createDomainsDocumentSearch}=await import('./assets/js/domains/documents/search-source.js');
 const {createGlobalDocumentSearch}=await import('./assets/js/shared/global-document-search.js');
 const check=(ok,message)=>{if(!ok)throw Error(message)},frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 async function eventually(predicate,message){const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw Error(message);await frame()}}
 for(const id of ['globalSearchBackdrop','globalSearchButton']){const node=document.getElementById(id);node.replaceWith(node.cloneNode(true))}
 const byId=id=>document.getElementById(id),results=byId('globalSearchResults'),input=byId('globalSearchInput');
 const jobs=new Map(),held=[],calls=[];let next=0,failPath='',driveCalls=0,previewKind='text',hasMore=false;
 const row={id:'D',name:'fixture.txt',fullPath:'C:\\fixture.txt',relativePath:'fixture.txt',size:5,modifiedAt:'2026-10-08'};
 const client=createDocumentBridgeClient({tokenStore:{get:()=> 'test-pair',set:()=>{}},createAbortController:()=>new AbortController(),
  timers:{setTimeout:(run,delay)=>{jobs.set(++next,{run,delay});return next},clearTimeout:id=>jobs.delete(id)},
  fetchRequest:async(url,options)=>{
   const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};calls.push({path,body});
   if(path===failPath){
    const item={path,body,signal:options.signal,deadline:[...jobs.values()].at(-1).run,consuming:false};held.push(item);
    const consume=()=>{item.consuming=true;return new Promise((_resolve,reject)=>{if(options.signal.aborted){reject(new DOMException('cancelled','AbortError'));return}options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true})})};
    return {ok:true,status:200,text:consume,blob:consume};
   }
   if(path==='/documents/preview')return new Response(JSON.stringify({ok:true,kind:previewKind,mime:'image/png',text:'fixture query',name:row.name}));
   if(path==='/documents/preview-file')return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII='),char=>char.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
   return new Response(JSON.stringify({ok:true,bridgeVersion:38,results:[{...row,name:body.query==='new'?'new.txt':row.name}],hasMore,elapsedMs:1,count:0}));
  }});
 const local={...client,warm:async()=>({ok:true}),pdfIndexStatus:undefined};
 const source=createDomainsDocumentSearch({localBridge:local,googleDrive:{getToken:()=> 'drive',search:async()=>{driveCalls++;return {results:[]}}},userAgent:'Windows'});
 const ui=createGlobalDocumentSearch({documentBridge:source,siteSearch:()=>({total:0,groups:[]})});ui.bind();
 async function start(query,filter='files'){
  ui.close({restoreFocus:false});input.value=query;ui.setFilter(filter);ui.open();
 }
 async function deadline(path){const offset=held.length;failPath=path;const active=()=>held.slice(offset).findLast(item=>item.path===path&&item.consuming&&!item.signal.aborted);return {fire:async()=>{await eventually(active,'request body never entered: '+path);const item=active();item.deadline();await frame();return item}}}
 async function assertError(host,spinner,label){await frame();check(!host.querySelector(spinner),label+' stayed loading');check(host.textContent.includes('לא הגיב בזמן'),label+' hid the timeout');check(host.textContent.includes('DOCUMENT_BRIDGE_TIMEOUT'),label+' lacks diagnostic code');check(host.querySelector('[data-document-retry]'),label+' lacks explicit retry')}
 const done=[];
 try{
  for(const [query,filter,path,label] of [['','files','/documents/recent','recent'],['query','files','/documents/search','file search'],['query','content','/documents/search','content search']]){
   const pending=await deadline(path);await start(query,filter);await pending.fire();
   await assertError(results,'.document-search-spinner',label);done.push(label);
   failPath='';results.querySelector('[data-document-retry]').click();await eventually(()=>results.querySelector('[data-document-result-id]'),'retry did not recover '+label);
  }
  failPath='';hasMore=true;await start('query');await eventually(()=>results.querySelector('[data-document-load-more]'),'paging fixture missing');
  const paging=await deadline('/documents/search');results.dispatchEvent(new Event('scroll'));await paging.fire();
  await assertError(results,'.document-search-load-more.loading','pagination');check(results.querySelector('[data-document-result-id]'),'pagination lost existing rows');done.push('pagination retains rows');
  hasMore=false;failPath='';results.querySelector('[data-document-retry]').click();await eventually(()=>!results.querySelector('.document-search-error'),'pagination retry failed');
  for(const [path,kind,label] of [['/documents/preview','text','preview metadata'],['/documents/preview-file','binary','preview body']]){
   previewKind=kind;const preview=await deadline(path);results.querySelector('[data-document-result-id]').click();await preview.fire();
   await assertError(byId('globalSearchPreviewBody'),'.document-preview-loading',label);done.push(label);
   failPath='';byId('globalSearchPreviewBody').querySelector('[data-document-retry]').click();await eventually(()=>!byId('globalSearchPreviewBody').querySelector('.document-preview-loading,.error'),'preview retry failed');
  }
  previewKind='text';failPath='';await start('query','content');await eventually(()=>results.querySelector('[data-document-result-id]'),'content preview fixture missing');
  const matching=await deadline('/documents/matches');results.querySelector('[data-document-result-id]').click();await matching.fire();
  const matches=byId('globalSearchPreviewMatches');check(!matches.hidden,'match timeout was hidden');await assertError(matches,'.document-preview-match-loading:not(.error)','preview matches');done.push('preview matches');
  failPath='';matches.querySelector('[data-document-retry]').click();await eventually(()=>!matches.querySelector('.error'),'match retry failed');
  await deadline('/documents/search');await start('old');await eventually(()=>held.at(-1)?.body.query==='old'&&held.at(-1).consuming,'old query did not start');const old=held.at(-1);
  failPath='';input.value='new';ui.renderResults('new');await eventually(()=>results.textContent.includes('new.txt'),'new query did not publish');old.deadline();await frame();
  check(old.signal.aborted&&!results.querySelector('.document-search-error,.document-search-spinner')&&results.textContent.includes('new.txt'),'stale cancellation/deadline replaced new results');done.push('stale request cannot overwrite new query');
  previewKind='text';await deadline('/documents/preview');results.querySelector('[data-document-result-id]').click();await eventually(()=>held.at(-1)?.path==='/documents/preview'&&held.at(-1).consuming,'old preview did not start');const oldPreview=held.at(-1);
  failPath='';results.querySelector('[data-document-result-id]').click();const previewBody=byId('globalSearchPreviewBody');await eventually(()=>previewBody.textContent.includes('fixture query')&&!previewBody.querySelector('.document-preview-loading'),'new preview did not publish');oldPreview.deadline();await frame();
  check(oldPreview.signal.aborted&&!previewBody.querySelector('.error,.document-preview-loading')&&previewBody.textContent.includes('fixture query'),'old preview deadline replaced the current view');done.push('preview cancellation releases transport and preserves new view');
  await deadline('/documents/search');await start('cancel');await eventually(()=>held.at(-1)?.body.query==='cancel'&&held.at(-1).consuming,'cancel query did not start');const cancelled=held.at(-1);ui.close();cancelled.deadline();await frame();
  check(byId('globalSearchBackdrop').hidden&&!results.querySelector('.document-search-error'),'caller cancellation became an error');done.push('caller cancellation stays quiet');
  check(driveCalls===0&&source.provider==='everything','deadline triggered Drive fallback');check(jobs.size===0,'deadline timers leaked');
  return {done,requests:calls.length,driveCalls};
 }finally{ui.close({restoreFocus:false})}
})()"""

for app in ('kupa', 'orders'):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-document-deadlines') as browser:
        result = browser.evaluate(FLOW, timeout=45)
        assert not browser.drain_serious_errors()
        print(f'PASS {app} client/source/search deadlines: {json.dumps(result)}', flush=True)
