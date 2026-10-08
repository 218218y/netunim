"""Production auth -> Drive integration -> source -> search UI with fake I/O."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const {composeDocumentSearch}=await import('./assets/js/shared/document-search-composition.js');
 const {createCloudAuth}=await import('./assets/js/cloud/auth.js');
 const {createGlobalDocumentSearch}=await import('./assets/js/shared/global-document-search.js');
 const app=__APP__,check=(ok,message)=>{if(!ok)throw Error(message)};
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 async function eventually(predicate,message){const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw Error(message);await frame()}}
 const auth=createCloudAuth({session:{},idbGet:async()=>null,idbPut:async()=>{},idbDelete:async()=>{},supaProjectRef:()=> 'fixture',setCloudHeaderStatus:()=>{}});
 const store=owner=>(app==='kupa'?auth.storeSupaSession:auth.saveSession)(owner?{user:{id:owner},access_token:'fixture-'+owner,expires_at:9999999999}:null);
 const requests=[],tokens=[],assigned=[];let holding=null,backendHolding=null;
 const row=token=>({id:'same-id',name:token+'.txt',mimeType:'text/plain',size:'20',webViewLink:'https://drive.google.com/file/d/'+token+'/view'});
 const source=composeDocumentSearch({accountScope:()=>auth.getAccountScope(),
  supaFetch:async(_url,options)=>{
   const owner=auth.getAccountScope().owner,action=JSON.parse(options.body).action;tokens.push({owner,action});
   if(backendHolding&&backendHolding.owner===owner){const item=backendHolding;return {ok:true,status:200,json:()=>{item.started.resolve();return item.release.promise}}}
   return new Response(JSON.stringify({access_token:'token-'+owner,expires_in:3600}));
  },
  drivePlatform:{clock:{now:()=>0},browser:{navigate:url=>assigned.push(url)},fetchRequest:async(url,options)=>{
   const parsed=new URL(url),token=options.headers.Authorization.slice(7),kind=parsed.searchParams.get('alt')==='media'?'media':parsed.pathname.endsWith('/files')?'list':'metadata';
   requests.push({kind,token,signal:options.signal});
   if(holding&&holding.kind===kind){const item=holding;const consume=()=>{item.started.resolve();return item.release.promise};return {ok:true,status:200,text:consume,arrayBuffer:consume}}
   return kind==='media'?new Response('fixture preview '+token):new Response(JSON.stringify(kind==='list'?{files:[row(token)]}:row(token)));
  }}
 });
 const hold=kind=>{const item={kind,started:deferred(),release:deferred()};holding=item;return item};
 const rejected=pending=>pending.then(()=>{throw Error('former account response succeeded')},error=>error.code);
 const done=[];
 store('A');await source.search('invoice');store('B');await source.search('invoice');
 check(requests.at(-1).token==='token-B'&&tokens.at(-1).owner==='B','cached A token crossed account boundary');
 check((await source.preview('drive:same-id')).name==='token-B.txt','cached A metadata crossed account boundary');done.push('account token and metadata isolation');
 const before=requests.length;store(null);check(await rejected(source.search('invoice'))==='google_drive_cloud_auth_required','logout accepted cached token');
 check(requests.length===before,'logout performed a Drive request');done.push('logout prevents cached-token I/O');
 store('A');const late=hold('list'),old=rejected(source.search('old'));await late.started.promise;
 holding=null;store('B');await source.search('new');late.release.resolve(JSON.stringify({files:[row('old-A')]}));
 check(await old==='GOOGLE_DRIVE_ACCOUNT_CHANGED','late list JSON published former owner');
 check((await source.preview('drive:same-id')).name==='token-B.txt','late list JSON poisoned B cache');done.push('late body cannot publish/cache');
 store('A');const relogin=hold('list'),same=rejected(source.recent());await relogin.started.promise;
 store(null);store('A');holding=null;relogin.release.resolve(JSON.stringify({files:[row('old-login')]}));
 check(await same==='GOOGLE_DRIVE_ACCOUNT_CHANGED','same-account relogin reused old authorization scope');done.push('same-account login epoch');
 source.clearToken();backendHolding={owner:'A',started:deferred(),release:deferred()};const oldToken=backendHolding,acquisition=rejected(source.search('token old'));
 await oldToken.started.promise;store('B');await source.search('token new');backendHolding=null;oldToken.release.resolve({access_token:'obsolete-A',expires_in:3600});
 check(await acquisition==='GOOGLE_DRIVE_ACCOUNT_CHANGED','late OAuth token accepted');
 await source.search('still B');check(requests.at(-1).token==='token-B','old token cleanup cleared B authorization');done.push('token acquisition ownership');
 const caller=new AbortController();caller.abort();const count=tokens.length;
 check(await rejected(source.search('cancel',{signal:caller.signal}))==='DOCUMENT_BRIDGE_ABORTED','pre-cancel ignored');
 check(tokens.length===count,'pre-cancel contacted OAuth');done.push('pre-cancel has no I/O');

 for(const id of ['globalSearchBackdrop','globalSearchButton']){const node=document.getElementById(id);node.replaceWith(node.cloneNode(true))}
 const byId=id=>document.getElementById(id),results=byId('globalSearchResults'),input=byId('globalSearchInput');
 const ui=createGlobalDocumentSearch({documentBridge:source,siteSearch:()=>({total:0,groups:[]})});ui.bind();
 async function start(query){ui.close({restoreFocus:false});input.value=query;ui.setFilter('files');ui.open()}
 try{
  store('A');const uiHeld=hold('list');await start('held');await uiHeld.started.promise;store('B');holding=null;
  uiHeld.release.resolve(JSON.stringify({files:[row('old-A')]}));
  await eventually(()=>results.querySelector('.document-search-error'),'account change left the search spinner');
  check(!results.querySelector('.document-search-spinner')&&results.textContent.includes('GOOGLE_DRIVE_ACCOUNT_CHANGED'),'scope rejection was silent');
  results.querySelector('[data-document-retry]').click();await eventually(()=>results.textContent.includes('token-B.txt'),'scope retry did not load B');done.push('UI scope failure and explicit retry');
  const previewHeld=hold('media');results.querySelector('[data-document-result-id]').click();await previewHeld.started.promise;store('A');holding=null;
  previewHeld.release.resolve(new TextEncoder().encode('private B preview').buffer);
  const preview=byId('globalSearchPreviewBody');await eventually(()=>preview.querySelector('.error'),'late preview stayed loading');
  check(!preview.querySelector('.document-preview-loading')&&!preview.textContent.includes('private B preview')&&preview.textContent.includes('GOOGLE_DRIVE_ACCOUNT_CHANGED'),'late preview exposed old content');
  preview.querySelector('[data-document-retry]').click();await eventually(()=>preview.textContent.includes('fixture preview token-A'),'preview retry failed');done.push('preview body scope and retry');
  const cancelled=hold('list');await start('obsolete');await cancelled.started.promise;holding=null;input.value='current';ui.renderResults('current');
  await eventually(()=>results.textContent.includes('token-A.txt')&&!results.querySelector('.document-search-spinner'),'current search never published');
  cancelled.release.resolve(JSON.stringify({files:[row('obsolete')]}));await frame();
  check(!results.textContent.includes('obsolete.txt')&&!results.querySelector('.document-search-error'),'cancelled query replaced current UI');done.push('cancelled query preserves current results');
  check(assigned.length===0,'test navigated outside the disposable profile');
  return {done,requests:requests.length,tokenRequests:tokens.length};
 }finally{ui.close({restoreFocus:false});store(null)}
})()"""

for app in ('kupa', 'orders'):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-google-drive-scope') as browser:
        result = browser.evaluate(FLOW.replace('__APP__', json.dumps(app)), timeout=45)
        assert not browser.drain_serious_errors()
        print(f'PASS {app} auth/Drive/source/search scope: {json.dumps(result)}', flush=True)
