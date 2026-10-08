import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleDriveClient} from '../netunim-orders/site/assets/js/shared/google-drive-client.js';
import {createAuthenticatedAccountScope} from '../netunim-orders/site/assets/js/shared/authenticated-account-scope.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(){
  let owner='A',epoch=0,now=0,reply=null,backendReply=null;const backendCalls=[],apiCalls=[],assigned=[];
  const backend=async(_url,options)=>{const captured=owner;backendCalls.push(captured);return backendReply?backendReply(options,captured):new Response(JSON.stringify({access_token:'token-'+captured,expires_in:3600}))};
  const request=async(url,options)=>{apiCalls.push(options.headers.Authorization);return reply?reply(options,url):new Response(JSON.stringify({files:[{id:'same-id',name:options.headers.Authorization+'.pdf',mimeType:'application/pdf',size:'4',webViewLink:'https://drive.google.com/file/d/same-id/view'}]}))};
  const api=createGoogleDriveClient({transport:{authenticatedRequest:backend,fetchRequest:request},accountScope:()=>({owner,epoch}),clock:{now:()=>now},browser:{navigate:url=>assigned.push(url)}});
  return {api,apiCalls,backendCalls,assigned,setOwner:value=>{owner=value},setEpoch:value=>{epoch=value},setNow:value=>{now=value},reply:value=>{reply=value},backendReply:value=>{backendReply=value}};
}

test('Drive token and result cache cannot cross an authenticated account change',async t=>{
  const f=fixture(t);await f.api.search('invoice');f.setOwner('B');await f.api.search('invoice');
  assert.deepEqual(f.backendCalls,['A','B']);assert.deepEqual(f.apiCalls,['Bearer token-A','Bearer token-B']);
});

test('logout rejects cached-token requests without contacting Drive',async t=>{
  const f=fixture(t);await f.api.search('invoice');f.setOwner(null);
  await assert.rejects(f.api.search('invoice'));assert.equal(f.apiCalls.length,1);
});

test('a late Drive response cannot publish or cache the former account data',async t=>{
  const f=fixture(t),started=deferred(),release=deferred();f.reply(()=>{started.resolve();return release.promise});
  const pending=f.api.search('invoice');await started.promise;f.setOwner('B');
  release.resolve(new Response(JSON.stringify({files:[{id:'old-id',name:'A private file',mimeType:'application/pdf'}]})));
  await assert.rejects(pending);
});

test('pre-cancelled Drive search performs no OAuth or data request',async t=>{
  const f=fixture(t),caller=new AbortController();caller.abort();
  await assert.rejects(f.api.search('invoice',{signal:caller.signal}),error=>error.code==='DOCUMENT_BRIDGE_ABORTED');
  assert.equal(f.backendCalls.length,0);assert.equal(f.apiCalls.length,0);
});

const changed=error=>error.code==='GOOGLE_DRIVE_ACCOUNT_CHANGED';
const cancelled=error=>error.code==='DOCUMENT_BRIDGE_ABORTED';
const tokenResponse=token=>new Response(JSON.stringify({access_token:token,expires_in:3600}));

test('cached metadata is re-read for the new owner before preview or navigation',async()=>{
  const f=fixture();await f.api.search('invoice');f.setOwner('B');
  f.reply(()=>new Response(JSON.stringify({id:'same-id',name:'B.pdf',mimeType:'application/pdf',webViewLink:'https://drive.google.com/file/d/B/view'})));
  assert.equal((await f.api.preview('same-id')).name,'B.pdf');
  await f.api.openDocument('same-id');assert.deepEqual(f.assigned,['https://drive.google.com/file/d/B/view']);
  assert.deepEqual(f.backendCalls,['A','B']);assert.equal(f.apiCalls.at(-1),'Bearer token-B');
});

test('logout and same-account login invalidate an in-flight response even when no request observed logout',async()=>{
  const f=fixture(),started=deferred(),release=deferred();f.reply(()=>{started.resolve();return release.promise});
  const pending=f.api.search('invoice');await started.promise;f.setOwner(null);f.setOwner('A');f.setEpoch(2);
  release.resolve(new Response(JSON.stringify({files:[]})));await assert.rejects(pending,changed);
  f.reply(null);await f.api.search('invoice');assert.deepEqual(f.backendCalls,['A','A']);
});

test('an old OAuth token flight cannot replace or clear a new account token flight',async()=>{
  const f=fixture(),aStarted=deferred(),a=deferred(),bStarted=deferred(),b=deferred();
  f.backendReply((_options,owner)=>{(owner==='A'?aStarted:bStarted).resolve();return (owner==='A'?a:b).promise});
  const old=f.api.search('old');await aStarted.promise;const rejected=assert.rejects(old,changed);
  f.setOwner('B');const current=f.api.search('new');await bStarted.promise;
  a.resolve(tokenResponse('old-A'));await rejected;
  const joined=f.api.search('joined');b.resolve(tokenResponse('new-B'));
  await Promise.all([current,joined]);assert.deepEqual(f.backendCalls,['A','B']);
  assert.deepEqual(f.apiCalls,['Bearer new-B','Bearer new-B']);
});

test('same-account parallel queries share refresh without one cancellation rejecting the other',async()=>{
  const f=fixture(),started=deferred(),release=deferred(),caller=new AbortController();
  f.backendReply(()=>{started.resolve();return release.promise});
  const first=f.api.search('first',{signal:caller.signal});await started.promise;
  const second=f.api.search('second');caller.abort();release.resolve(tokenResponse('shared'));
  await assert.rejects(first,cancelled);await second;
  assert.equal(f.backendCalls.length,1);assert.deepEqual(f.apiCalls,['Bearer shared']);
});

test('clearToken fences outstanding acquisitions and clears metadata before same-account retry',async()=>{
  const f=fixture(),started=deferred(),release=deferred();f.backendReply(()=>{started.resolve();return release.promise});
  const pending=f.api.search('old');await started.promise;f.api.clearToken();release.resolve(tokenResponse('old'));
  await assert.rejects(pending,changed);f.backendReply(null);await f.api.search('new');assert.equal(f.apiCalls[0],'Bearer token-A');
});

test('owner change while OAuth JSON is read rejects before accepting a token',async()=>{
  const f=fixture(),started=deferred(),release=deferred();
  f.backendReply(()=>({ok:true,status:200,json:()=>{started.resolve();return release.promise}}));
  const pending=f.api.search('invoice');await started.promise;f.setOwner('B');release.resolve({access_token:'old-A'});
  await assert.rejects(pending,changed);assert.equal(f.apiCalls.length,0);
});

test('owner change while list JSON is read cannot poison the new result cache',async()=>{
  const f=fixture(),started=deferred(),release=deferred();
  f.reply(()=>({ok:true,status:200,text:()=>{started.resolve();return release.promise}}));
  const pending=f.api.search('invoice');await started.promise;f.setOwner('B');
  f.reply(()=>new Response(JSON.stringify({id:'same-id',name:'B.pdf',mimeType:'application/pdf'})));
  assert.equal((await f.api.preview('same-id')).name,'B.pdf');
  release.resolve(JSON.stringify({files:[{id:'same-id',name:'A.pdf',mimeType:'application/pdf'}]}));
  await assert.rejects(pending,changed);assert.equal((await f.api.preview('same-id')).name,'B.pdf');
});

test('owner change during preview body consumption rejects the old blob',async()=>{
  const f=fixture(),started=deferred(),release=deferred();await f.api.search('invoice');
  f.reply(()=>({ok:true,status:200,arrayBuffer:()=>{started.resolve();return release.promise}}));
  const pending=f.api.previewFile('same-id');await started.promise;f.setOwner('B');release.resolve(new Uint8Array([1,2]).buffer);
  await assert.rejects(pending,changed);
});

test('preview cancellation reaches uncached metadata and fails quietly before reading its result',async()=>{
  const f=fixture(),started=deferred(),release=deferred(),caller=new AbortController();let received;
  f.reply(options=>{received=options.signal;started.resolve();return release.promise});
  const pending=f.api.preview('uncached',{signal:caller.signal});await started.promise;assert.equal(received,caller.signal);
  caller.abort();release.resolve(new Response(JSON.stringify({id:'uncached',mimeType:'text/plain'})));
  await assert.rejects(pending,cancelled);
});

test('aborted body consumption has the cancellation code rather than a raw AbortError',async()=>{
  const f=fixture(),started=deferred(),release=deferred(),caller=new AbortController();
  f.reply(()=>({ok:true,status:200,text:()=>{started.resolve();return release.promise}}));
  const pending=f.api.recent({signal:caller.signal});await started.promise;caller.abort();release.resolve('');
  await assert.rejects(pending,cancelled);
});

test('token expiry obtains a new token with the injected clock',async()=>{
  const f=fixture();await f.api.search('first');f.setNow(3_580_000);await f.api.search('second');
  assert.deepEqual(f.backendCalls,['A','A']);
});

test('Drive 401 does not retry silently and the next explicit request refreshes the token',async()=>{
  const f=fixture();f.reply(()=>new Response(JSON.stringify({error:{message:'expired'}}),{status:401}));
  await assert.rejects(f.api.search('invoice'),error=>error.code==='google_drive_reconnect_required');
  assert.equal(f.apiCalls.length,1);f.reply(null);await f.api.search('invoice');assert.equal(f.backendCalls.length,2);
});

test('a delayed 401 for an expired token cannot clear a newer token in the same login',async()=>{
  const f=fixture(),started=deferred(),release=deferred();let issued=0;
  f.backendReply(()=>tokenResponse('token-'+(++issued)));
  f.reply(()=>{started.resolve();return release.promise});
  const old=assert.rejects(f.api.search('old'),error=>error.code==='google_drive_reconnect_required');await started.promise;
  f.setNow(3_580_000);f.reply(null);await f.api.search('new');
  release.resolve(new Response('{}',{status:401}));await old;await f.api.search('still current');
  assert.equal(issued,2);assert.equal(f.apiCalls.at(-1),'Bearer token-2');
});

test('offline failure is explicit and a subsequent request recovers without discarding valid authorization',async()=>{
  const f=fixture();f.reply(()=>{throw new TypeError('offline')});
  await assert.rejects(f.api.search('invoice'),error=>error.code==='GOOGLE_DRIVE_UNAVAILABLE');
  f.reply(null);assert.equal((await f.api.search('invoice')).results.length,1);assert.equal(f.backendCalls.length,1);
});

test('malformed JSON and download refusal remain visible typed failures',async()=>{
  const f=fixture();f.reply(()=>new Response('{bad'));
  await assert.rejects(f.api.search('invoice'),error=>error.code==='GOOGLE_DRIVE_INVALID_RESPONSE');
  f.reply(()=>new Response(JSON.stringify({error:{message:'restricted'}}),{status:403}));
  await assert.rejects(f.api.search('invoice'),error=>error.code==='GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN'&&error.status===403);
});

test('late connect authorization never navigates after a login change',async()=>{
  const f=fixture(),started=deferred(),release=deferred();f.backendReply(()=>{started.resolve();return release.promise});
  const pending=f.api.beginConnect({returnUrl:'https://example.test'});await started.promise;f.setOwner('B');
  release.resolve(new Response(JSON.stringify({authorize_url:'https://accounts.google.com/o/oauth2/auth'})));
  await assert.rejects(pending,changed);assert.deepEqual(f.assigned,[]);
});

test('late disconnect of the previous account cannot clear the new token or cache',async()=>{
  const f=fixture(),started=deferred(),release=deferred();await f.api.search('invoice');
  f.backendReply(options=>{if(JSON.parse(options.body).action==='disconnect'){started.resolve();return release.promise}return tokenResponse('new-B')});
  const pending=f.api.disconnect();await started.promise;f.setOwner('B');await f.api.search('new');
  release.resolve(new Response('{}'));await assert.rejects(pending,changed);
  await f.api.search('still B');assert.equal(f.backendCalls.length,3);assert.equal(f.apiCalls.at(-1),'Bearer new-B');
});

test('successful disconnect invalidates token acquisitions that started while revocation was pending',async()=>{
  const f=fixture(),started=deferred(),release=deferred(),tokenStarted=deferred(),token=deferred();
  f.backendReply(options=>{const disconnect=JSON.parse(options.body).action==='disconnect';(disconnect?started:tokenStarted).resolve();return (disconnect?release:token).promise});
  const disconnect=f.api.disconnect();await started.promise;const query=f.api.search('during revoke');await tokenStarted.promise;
  release.resolve(new Response('{}'));assert.equal(await disconnect,true);token.resolve(tokenResponse('revoked'));
  await assert.rejects(query,changed);assert.equal(f.apiCalls.length,0);
});

test('auth scope records logout/relogin even if the Drive client did not observe the intermediate state',()=>{
  let session={user:{id:'A'}};const scope=createAuthenticatedAccountScope({loadSession:()=>session});const initial=scope.current();
  session={...session,access_token:'refreshed'};scope.replace(session,{refresh:true});assert.deepEqual(scope.current(),initial);
  session=null;scope.replace(session);session={user:{id:'A'}};scope.replace(session);
  const next=scope.current();assert.equal(next.owner,'A');assert.ok(next.epoch>initial.epoch);
});
