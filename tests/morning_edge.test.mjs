import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const rows=[],requests=[];
let failure='',postCount=0,tokenCount=0,linkCount=0,rateLimitHits=0,lookupItems=[],lastSearch,servedHandler=null;
const owner='00000000-0000-4000-8000-000000000001',otherOwner='00000000-0000-4000-8000-000000000009',documentId='00000000-0000-4000-8000-000000000002';
const sample={id:documentId,number:123,type:305,amount:100,documentDate:'2026-09-08',creationDate:Math.floor(Date.now()/1000),client:{name:'Test'},description:'Test document',currency:'ILS',status:0,url:{he:'https://example.org/private-signed.pdf'},allocationNumber:'allocation-123'};
const morningDocs=new Map([[documentId,sample]]);
class Query{
  constructor(){this.filters=[];this.mode='select';this.patch=null;this.one=false}
  select(){return this}eq(key,value){this.filters.push(row=>row[key]===value);return this}neq(key,value){this.filters.push(row=>row[key]!==value);return this}in(key,values){this.filters.push(row=>values.includes(row[key]));return this}order(){return this}limit(){return this}maybeSingle(){this.one=true;return this}single(){this.one=true;return this}
  insert(row){this.mode='insert';this.patch=row;return this}update(patch){this.mode='update';this.patch=patch;return this}
  then(resolve,reject){return Promise.resolve().then(()=>{
    if(this.mode==='insert'){
      const row=this.patch;
      if(rows.some(existing=>existing.operation_id===row.operation_id||(existing.environment===row.environment&&existing.request_fingerprint===row.request_fingerprint&&['reserved','pending','created_unverified','needs_reconciliation'].includes(existing.state))||(row.document_id&&existing.environment===row.environment&&existing.document_id===row.document_id)))return {data:null,error:{code:'23505'}};
      const saved={...row,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),reconciliation_attempts:0};rows.push(saved);return {data:saved,error:null};
    }
    const selected=rows.filter(row=>this.filters.every(filter=>filter(row)));
    if(this.mode==='update'){for(const row of selected){const candidate={...row,...this.patch};if(candidate.document_id&&rows.some(other=>other!==row&&other.environment===candidate.environment&&other.document_id===candidate.document_id))return {data:null,error:{code:'23505',message:'duplicate document id'}};Object.assign(row,this.patch)}return {data:this.one?selected[0]||null:selected,error:null}}
    return {data:this.one?selected[0]||null:selected,error:null};
  }).then(resolve,reject)}
}
const mockFetch=async(url,init={})=>{
  requests.push({url,init});
  if(url.includes('oauth/token')){tokenCount++;return Response.json({access_token:'test-only',expires_in:3600})};
  if(url.includes('/documents/types')){if(failure==='status-down')return Response.json({message:'down'},{status:503});return Response.json([{id:305,name:'Invoice'}])};
  if(url.endsWith('/documents/search')){lastSearch=JSON.parse(init.body);return Response.json({items:lookupItems,total:lookupItems.length,pages:lookupItems.length?1:0,page:1})}
  if(url.endsWith('/download/links')){const value={he:`https://example.org/document.pdf?fresh=${++linkCount}`};return Response.json(failure==='wrapped-links'?{data:value}:value)};
  if(url.startsWith('https://example.org/document.pdf?fresh='))return new Response(new TextEncoder().encode('%PDF-1.4\nmock document\n'),{status:200,headers:{'Content-Type':'application/pdf','Content-Length':'24'}});
  if(url.endsWith('/documents')){postCount++;if(failure==='timeout')throw new Error('network lost');if(failure==='401')return Response.json({message:'rejected'},{status:401});if(failure==='408-create')return Response.json({message:'request timeout'},{status:408});if(failure==='521-create')return Response.json({message:'upstream unavailable'},{status:521});if(failure==='429-create')return Response.json({message:'rate limited'},{status:429,headers:{'Retry-After':'0'}});const payload=JSON.parse(init.body||'{}'),id=postCount===1?documentId:`00000000-0000-4000-8000-${String(100+postCount).padStart(12,'0')}`,created={...sample,id,number:122+postCount,type:Number(payload.type||305),amount:Number(payload.income?.[0]?.price||100),documentDate:String(payload.date||'2026-09-08'),creationDate:Math.floor(Date.now()/1000),client:{name:String(payload.client?.name||'Test')},description:String(payload.description||'Test document')};morningDocs.set(id,created);return Response.json(created)}
  if(url.includes('/documents/')){if(failure==='readback')return Response.json({message:'read-back unavailable'},{status:503});if(failure==='read429'&&rateLimitHits++===0)return Response.json({message:'rate limited'},{status:429,headers:{'Retry-After':'0'}});const id=decodeURIComponent(url.split('/documents/')[1].split('/')[0]),doc=morningDocs.get(id)||sample;if(failure==='mismatch')return Response.json({...doc,amount:999});if(failure==='wrapped-read')return Response.json({data:doc});return Response.json(doc)};
  throw new Error('Unexpected request '+url);
};
const context=vm.createContext({console,Response,Request,URL,AbortController,TextEncoder,crypto:globalThis.crypto,atob:globalThis.atob,setTimeout,clearTimeout,fetch:mockFetch,createClient:()=>({from:()=>new Query(),auth:{getUser:async()=>({data:{user:{id:owner}}})}}),Deno:{env:{get:key=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',MORNING_CLIENT_ID:'test',MORNING_CLIENT_SECRET:'test',MORNING_ENV:'sandbox'})[key]},serve:handler=>{servedHandler=handler}}});
const source=readFileSync(new URL('../netunim-orders/supabase/functions/morning-documents/index.ts',import.meta.url),'utf8').replace(/^import .*?;\r?\n/,'');
vm.runInContext(stripTypeScriptTypes(source)+`\nglobalThis.api={create,status,searchInput,searchDocuments,getDocument,getDocumentPdf,normalizeInput,validateLinkedDocument,readResponseBytesBounded,validatePreviewPdfBase64,sha256};`,context);
const api=context.api;
const body=(amount=100,description='Test document')=>({operation_id:crypto.randomUUID(),document:{type:305,amount,date:'2026-09-08',description,client:{name:'Test'}}});
const decode=async response=>({status:response.status,...await response.json()});

const first=body(100);const results=await Promise.all([api.create(owner,first),api.create(owner,first)]);
if(postCount!==1)console.log(await Promise.all(results.map(r=>r.clone().json())));
assert.equal(postCount,1,'same operation never POSTs twice during a race');
assert.ok(results.every(r=>[200,409].includes(r.status)));
assert.ok(!('debt_id' in rows[0]));assert.ok(!('document_url' in rows[0]));
assert.equal(rows[0].environment,'sandbox');assert.equal(rows[0].state,'created');assert.ok(rows[0].issuance_started_at,'external issuance window starts only after the atomic reservation claim');assert.ok(rows[0].verified_at,'created means canonical read-back was persisted');
const replayed=await decode(await api.create(owner,first));assert.equal(replayed.replayed,true);assert.equal(replayed.verified,true);
const laterIdentical=await decode(await api.create(owner,body(100)));assert.equal(laterIdentical.verified,true);assert.equal(postCount,2,'a distinct later operation may intentionally issue identical business content; exactly-once is scoped to operation_id, not content forever');
const changed={...first,document:{...first.document,amount:101}};
assert.equal((await decode(await api.create(owner,changed))).code,'morning_operation_conflict');assert.equal(postCount,2);
assert.equal(api.normalizeInput(first).payload.income[0].vatType,1,'gross-amount VAT-included behavior is intentionally preserved until sandbox validation proves an API enum change');

// A successful POST is not success until the same Morning ID is canonically re-read and matched.
failure='readback';const readbackPending=body(110);const pendingResult=await decode(await api.create(owner,readbackPending));
assert.equal(pendingResult.status,502);assert.equal(pendingResult.code,'morning_creation_verification_pending');assert.equal(pendingResult.uncertain,true);assert.equal(postCount,3);
const pendingRow=rows.find(r=>r.operation_id===readbackPending.operation_id);assert.equal(pendingRow.state,'created_unverified');assert.equal(pendingRow.document_id,pendingResult.document.id);assert.equal(pendingRow.verified_at,undefined);
assert.equal((await decode(await api.create(owner,readbackPending))).status,409);assert.equal(postCount,3,'known-but-unverified document is never POSTed again');
const pendingOther=await decode(await api.create(owner,body(110)));assert.equal(pendingOther.operation_id,readbackPending.operation_id);assert.equal(postCount,3,'known-but-unverified fingerprint blocks a fresh operation ID');
const pendingForeign=await decode(await api.create(otherOwner,body(110)));assert.equal(pendingForeign.status,409);assert.equal(pendingForeign.operation_id,undefined,'foreign owner operation IDs are not exposed');assert.equal(postCount,3,'unresolved fingerprint blocks across app users');
failure='';const foreignGuard=await decode(await api.create(otherOwner,body(110)));assert.equal(foreignGuard.status,409);assert.equal(foreignGuard.code,'morning_similar_operation_verified');assert.equal(foreignGuard.prevent_retry,true);assert.equal(foreignGuard.operation_id,undefined,'cross-user guard does not expose the other owner operation ID');assert.equal(postCount,3,'a blocked user can safely trigger server-side GET reconciliation without issuing another document');
const verifiedLater=await decode(await api.status(owner,{operation_id:readbackPending.operation_id}));assert.equal(verifiedLater.operation.state,'created');assert.ok(verifiedLater.operation.verified_at);assert.equal(postCount,3,'global duplicate-guard reconciliation uses GET only');

// A mismatching canonical read-back also stays blocked instead of becoming a false success.
failure='mismatch';const mismatchOp=body(120);const mismatchResult=await decode(await api.create(owner,mismatchOp));assert.equal(mismatchResult.code,'morning_creation_verification_pending');assert.equal(rows.find(r=>r.operation_id===mismatchOp.operation_id).state,'created_unverified');assert.equal(postCount,4);failure='';
await api.status(owner,{operation_id:mismatchOp.operation_id,reconcile:true});assert.equal(rows.find(r=>r.operation_id===mismatchOp.operation_id).state,'created');

failure='timeout';const uncertain=body(130,'Timeout reconciliation');
assert.equal((await decode(await api.create(owner,uncertain))).uncertain,true);assert.equal(postCount,5);
const blocked=await decode(await api.create(owner,body(130,'Timeout reconciliation')));
assert.equal(blocked.operation_id,uncertain.operation_id);assert.equal(postCount,5,'unresolved fingerprint blocks new operation UUID');
const row=rows.find(r=>r.operation_id===uncertain.operation_id);row.created_at=new Date(Date.now()-600_000).toISOString();row.issuance_started_at=row.created_at;
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});
assert.equal(row.state,'needs_reconciliation','absence never releases an ambiguous POST for retry');assert.equal(row.reconciliation_attempts,1);
// A document already assigned to another operation cannot resolve this one, even across owners.
const claimedCandidate={...sample,amount:130,description:'Timeout reconciliation',creationDate:new Date(new Date(row.created_at).getTime()+30_000).toISOString()};lookupItems=[claimedCandidate];morningDocs.set(documentId,claimedCandidate);
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});assert.equal(row.state,'needs_reconciliation');
const reconciledId='00000000-0000-4000-8000-000000000077',unclaimedCandidate={...claimedCandidate,id:reconciledId};lookupItems=[unclaimedCandidate];morningDocs.set(reconciledId,unclaimedCandidate);
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});assert.equal(row.state,'created');assert.ok(row.verified_at);assert.equal(postCount,5);assert.equal(row.document_id,reconciledId,'ISO creationDate is accepted during strict reconciliation');
const foreign=await decode(await api.status(otherOwner,{operation_id:uncertain.operation_id}));assert.equal(foreign.operation,null);
failure='status-down';const outageStatus=await decode(await api.status(owner,{operation_id:uncertain.operation_id}));assert.equal(outageStatus.status,200);assert.equal(outageStatus.available,false);assert.equal(outageStatus.operation.operation_id,uncertain.operation_id,'Morning outage must not hide durable ledger state');failure='';
failure='401';const tokensBefore401=tokenCount;await api.create(owner,body(140));assert.equal(postCount,6,'401 on create is not automatically retried');assert.equal(tokenCount,tokensBefore401,'issuing POST itself never refreshes-and-retries after 401');failure='';const postsBeforeFreshToken=postCount;const tokensBeforeFreshAttempt=tokenCount;const after401=await decode(await api.create(owner,body(141,'Fresh token after 401')));assert.equal(after401.verified,true);assert.equal(postCount,postsBeforeFreshToken+1);assert.equal(tokenCount,tokensBeforeFreshAttempt+1,'401 invalidates the cached token so the next explicit operation authenticates afresh');
failure='408-create';const before408=postCount;const timeoutResponse=await decode(await api.create(owner,body(148)));assert.equal(timeoutResponse.code,'morning_creation_uncertain');assert.equal(postCount,before408+1,'HTTP 408 on issuing POST is never automatically retried and remains blocked for reconciliation');failure='';
failure='521-create';const before521=postCount;const upstreamResponse=await decode(await api.create(owner,body(149)));assert.equal(upstreamResponse.code,'morning_creation_uncertain');assert.equal(postCount,before521+1,'every 5xx on issuing POST is treated as ambiguous and is never automatically retried');failure='';
failure='429-create';const beforeCreate429=postCount;const limitedCreate=await decode(await api.create(owner,body(150)));assert.equal(limitedCreate.code,'morning_create_failed');assert.equal(postCount,beforeCreate429+1,'429 on issuing POST is never automatically retried');failure='';
failure='read429';rateLimitHits=0;const beforeRateRead=requests.filter(r=>r.url.endsWith('/documents/'+documentId)).length;const rateRead=await api.getDocument({document_id:documentId});assert.equal(rateRead.status,200);assert.equal(requests.filter(r=>r.url.endsWith('/documents/'+documentId)).length,beforeRateRead+2,'429 on safe GET is retried with backoff');failure='';
failure='wrapped-read';const wrappedRead=await decode(await api.getDocument({document_id:documentId}));assert.equal(wrappedRead.document.id,documentId,'canonical document reads accept the v2 data wrapper without weakening verification');await api.validateLinkedDocument({linkedDocumentId:documentId});failure='';
lookupItems=[sample];morningDocs.set(documentId,sample);

const input={fromDate:'2026-06-10',toDate:'2026-09-08',page:0,pageSize:25,type:[305],status:[0],clientName:'Test',sort:'documentDate',order:'DESC'};
await api.searchDocuments({...input,owner_id:'evil',payload:{type:[666]}});
assert.equal(lastSearch.page,1);assert.equal(lastSearch.pageSize,25);assert.ok(!('payload' in lastSearch));assert.ok(!('owner_id' in lastSearch));
for(const patch of [{page:-1},{page:1.5},{pageSize:51},{pageSize:0},{type:[666]},{status:[5]},{clientName:'x'.repeat(161)},{sort:'arbitrary'},{order:'DROP'},{fromDate:'2026-02-30'},{fromDate:'2027-01-01'}])assert.equal((await api.searchDocuments({...input,...patch})).status,400,JSON.stringify(patch));
const searched=await decode(await api.searchDocuments(input));assert.equal(searched.items[0].id,documentId);assert.ok(!JSON.stringify(searched).includes('signed.pdf'));
const beforeDetails=requests.filter(r=>r.url.endsWith('/documents/'+documentId)).length;
await api.searchDocuments(input);assert.equal(requests.filter(r=>r.url.endsWith('/documents/'+documentId)).length,beforeDetails,'no detail GET for every result');
await api.validateLinkedDocument({linkedDocumentId:documentId});sample.status=4;await assert.rejects(()=>api.validateLinkedDocument({linkedDocumentId:documentId}));sample.status=0;
assert.equal((await api.getDocument({document_id:'../bad'})).status,400);
const link1=await decode(await api.getDocument({document_id:documentId},true)),link2=await decode(await api.getDocument({document_id:documentId},true));assert.notEqual(link1.url,link2.url);assert.equal(linkCount,2);
failure='wrapped-links';const wrappedLink=await decode(await api.getDocument({document_id:documentId},true));assert.match(wrappedLink.url,/^https:\/\/example\.org\/document\.pdf/,'download links accept the v2 data wrapper and direct language maps');failure='';
assert.ok(!('viewUrl' in link1),'document_links no longer exposes a Morning app-page URL');
const pdf=await api.getDocumentPdf({document_id:documentId});assert.equal(pdf.status,200);assert.match(pdf.headers.get('Content-Type')||'',/^application\/pdf/i);assert.equal(new TextDecoder().decode(await pdf.arrayBuffer()).slice(0,5),'%PDF-');assert.equal(linkCount,4,'inline preview gets its own fresh PDF link');
const smallPdf=Buffer.from('%PDF-1.4\nsmall');assert.equal(api.validatePreviewPdfBase64(smallPdf.toString('base64')),smallPdf.toString('base64'));assert.throws(()=>api.validatePreviewPdfBase64(Buffer.from('not a pdf body').toString('base64')),/אינה PDF/);
await assert.rejects(()=>api.readResponseBytesBounded(new Response(new Uint8Array(11)),10),error=>error?.status===413,'streamed PDF reads stop at the byte cap instead of buffering an unbounded response');

// A DB-only reservation can be resumed safely: only the atomic reserved->pending claim may issue.
const resumable=body(198,'Reserved resume'),resumableInput=api.normalizeInput(resumable),resumableFingerprint=await api.sha256(JSON.stringify(resumableInput.fingerprintSource)),resumableNow=new Date().toISOString();
rows.push({owner_id:owner,operation_id:resumable.operation_id,environment:'sandbox',request_fingerprint:resumableFingerprint,state:'reserved',document_type:305,amount:198,document_date:'2026-09-08',client_name:'Test',description:'Reserved resume',reconciliation_attempts:0,created_at:resumableNow,updated_at:resumableNow});
const beforeResume=postCount,resumed=await decode(await api.create(owner,resumable));assert.equal(resumed.verified,true);assert.equal(postCount,beforeResume+1,'same reserved operation resumes with exactly one issuing POST');const resumedRow=rows.find(r=>r.operation_id===resumable.operation_id);assert.equal(resumedRow.state,'created');assert.ok(resumedRow.issuance_started_at);

// A stale reservation from a crashed pre-POST request is safe to release because state=reserved proves Morning was never called for it.
const staleRequest=body(199,'Stale reservation'),staleInput=api.normalizeInput(staleRequest),staleFingerprint=await api.sha256(JSON.stringify(staleInput.fingerprintSource)),staleAt=new Date(Date.now()-180_000).toISOString(),staleOperationId='00000000-0000-4000-8000-000000000088';
rows.push({owner_id:otherOwner,operation_id:staleOperationId,environment:'sandbox',request_fingerprint:staleFingerprint,state:'reserved',document_type:305,amount:199,document_date:'2026-09-08',client_name:'Test',description:'Stale reservation',reconciliation_attempts:0,created_at:staleAt,updated_at:staleAt});
const beforeStale=postCount,staleRecovered=await decode(await api.create(owner,staleRequest));assert.equal(staleRecovered.verified,true);assert.equal(postCount,beforeStale+1,'stale pre-POST reservation is released and replaced without duplicate issuance');const staleRow=rows.find(r=>r.operation_id===staleOperationId);assert.equal(staleRow.state,'failed');assert.equal(staleRow.error_code,'reservation_abandoned');assert.equal(staleRow.client_name,'');assert.equal(staleRow.description,'');
assert.ok(rows.every(r=>!JSON.stringify(r).includes('https://')));
assert.ok(servedHandler,'Edge handler is registered');
const preflight=await servedHandler(new Request('https://example.supabase.co/functions/v1/morning-documents',{method:'OPTIONS',headers:{Origin:'http://localhost:3000','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'}}));
assert.equal(preflight.status,200);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'*');assert.match(preflight.headers.get('Access-Control-Allow-Headers')||'',/authorization/i);
const anonymous=await decode(await servedHandler(new Request('https://example.supabase.co/functions/v1/morning-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status'})})));
assert.equal(anonymous.status,401);assert.equal(anonymous.code,'morning_cloud_auth_required');
console.log('PASS Morning Edge: account-wide unresolved deduplication with safe cross-user reconciliation, operation-scoped exactly-once, atomic pre-issue reservation, verified create semantics, safe 429 handling, read-back failure blocking, races, replay, uncertain POST, reconciliation, outage visibility, owner isolation, search whitelist, manual invoice linking, bounded transient PDF, CORS and auth');
