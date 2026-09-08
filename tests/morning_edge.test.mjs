import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const rows=[],requests=[];
let failure='',postCount=0,linkCount=0,lookupItems=[],lastSearch;
const owner='00000000-0000-4000-8000-000000000001',documentId='00000000-0000-4000-8000-000000000002';
const sample={id:documentId,number:123,type:305,amount:100,documentDate:'2026-09-08',creationDate:Math.floor(Date.now()/1000),client:{name:'Test'},description:'Test document',currency:'ILS',status:0,url:{he:'https://example.org/private-signed.pdf'},allocationNumber:'allocation-123'};
class Query{
  constructor(){this.filters=[];this.mode='select';this.patch=null;this.one=false}
  select(){return this}eq(key,value){this.filters.push(row=>row[key]===value);return this}neq(key,value){this.filters.push(row=>row[key]!==value);return this}in(key,values){this.filters.push(row=>values.includes(row[key]));return this}order(){return this}limit(){return this}maybeSingle(){this.one=true;return this}single(){this.one=true;return this}
  insert(row){this.mode='insert';this.patch=row;return this}update(patch){this.mode='update';this.patch=patch;return this}
  then(resolve,reject){return Promise.resolve().then(()=>{
    if(this.mode==='insert'){
      const row=this.patch;
      if(rows.some(existing=>existing.operation_id===row.operation_id||(existing.owner_id===row.owner_id&&existing.environment===row.environment&&existing.request_fingerprint===row.request_fingerprint&&['pending','needs_reconciliation'].includes(existing.state))))return {data:null,error:{code:'23505'}};
      const saved={...row,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),reconciliation_attempts:0};rows.push(saved);return {data:saved,error:null};
    }
    const selected=rows.filter(row=>this.filters.every(filter=>filter(row)));
    if(this.mode==='update'){for(const row of selected)Object.assign(row,this.patch);return {error:null}}
    return {data:this.one?selected[0]||null:selected,error:null};
  }).then(resolve,reject)}
}
const mockFetch=async(url,init={})=>{
  requests.push({url,init});
  if(url.includes('oauth/token'))return Response.json({access_token:'test-only',expires_in:3600});
  if(url.endsWith('/businesses/me'))return Response.json({id:'business'});
  if(url.endsWith('/documents/search')){lastSearch=JSON.parse(init.body);return Response.json({items:lookupItems,total:lookupItems.length,pages:lookupItems.length?1:0,page:1})}
  if(url.endsWith('/download/links'))return Response.json({he:`https://example.org/document.pdf?fresh=${++linkCount}`});
  if(url.endsWith('/documents')){postCount++;if(failure==='timeout')throw new Error('network lost');if(failure==='401')return Response.json({message:'rejected'},{status:401});return Response.json(sample)}
  if(url.includes('/documents/'))return Response.json(sample);
  throw new Error('Unexpected request '+url);
};
const context=vm.createContext({console,Response,Request,URL,AbortController,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:mockFetch,createClient:()=>({from:()=>new Query(),auth:{getUser:async()=>({data:{user:{id:owner}}})}}),Deno:{env:{get:key=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',MORNING_CLIENT_ID:'test',MORNING_CLIENT_SECRET:'test',MORNING_ENV:'sandbox'})[key]},serve:()=>{}}});
const source=readFileSync(new URL('../netunim-orders/supabase/functions/morning-documents/index.ts',import.meta.url),'utf8').replace(/^import .*?;\r?\n/,'');
vm.runInContext(stripTypeScriptTypes(source)+`\nglobalThis.api={create,status,searchInput,searchDocuments,getDocument,normalizeInput,validateLinkedDocument};`,context);
const api=context.api;
const body=()=>({operation_id:crypto.randomUUID(),document:{type:305,amount:100,date:'2026-09-08',description:'Test document',client:{name:'Test'}}});
const decode=async response=>({status:response.status,...await response.json()});

const first=body();const results=await Promise.all([api.create(owner,first),api.create(owner,first)]);
if(postCount!==1)console.log(await Promise.all(results.map(r=>r.clone().json())));
assert.equal(postCount,1,'same operation never POSTs twice during a race');
assert.ok(results.every(r=>[200,409].includes(r.status)));
assert.ok(!('debt_id' in rows[0]));assert.ok(!('document_url' in rows[0]));
assert.equal(rows[0].environment,'sandbox');assert.equal(rows[0].state,'created');
assert.equal((await decode(await api.create(owner,first))).replayed,true);
await api.create(owner,body());assert.equal(postCount,2,'created fingerprint allows a later intentional identical issuance');
const changed={...first,document:{...first.document,amount:101}};
assert.equal((await decode(await api.create(owner,changed))).code,'morning_operation_conflict');assert.equal(postCount,2);

failure='timeout';const uncertain=body();
assert.equal((await decode(await api.create(owner,uncertain))).uncertain,true);assert.equal(postCount,3);
const blocked=await decode(await api.create(owner,body()));
assert.equal(blocked.operation_id,uncertain.operation_id);assert.equal(postCount,3,'unresolved fingerprint blocks new operation UUID');
const row=rows.find(r=>r.operation_id===uncertain.operation_id);row.created_at=new Date(Date.now()-600_000).toISOString();
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});
assert.equal(row.state,'needs_reconciliation','absence never releases an ambiguous POST for retry');assert.equal(row.reconciliation_attempts,1);
// A document already assigned to another operation cannot resolve this one.
lookupItems=[sample];sample.creationDate=Math.floor(new Date(row.created_at).getTime()/1000)+30;
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});assert.equal(row.state,'needs_reconciliation');
for(const old of rows)if(old!==row)old.document_id='other-document';
await api.status(owner,{operation_id:uncertain.operation_id,reconcile:true});assert.equal(row.state,'created');assert.equal(postCount,3);
const foreign=await decode(await api.status('another-owner',{operation_id:uncertain.operation_id}));assert.equal(foreign.operation,null);
failure='401';await api.create(owner,body());assert.equal(postCount,4,'401 on create is not automatically retried');failure='';

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
assert.ok(rows.every(r=>!JSON.stringify(r).includes('https://')));
assert.equal(link1.viewUrl,`https://app.sandbox.d.greeninvoice.co.il/incomes/documents/${documentId}`);
console.log('PASS Morning Edge: reservations, races, replay, uncertain POST, operation reconciliation, owner isolation, search whitelist, manual invoice linking and fresh links');
