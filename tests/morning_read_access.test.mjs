import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {createMorningReportsHandler, reportPermission, reportDocument, reportExpense} from '../netunim-orders/supabase/functions/morning-documents/reports.js';

const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const documentId='00000000-0000-4000-8000-000000000003';
const rawDocument={id:documentId,type:305,number:1,documentDate:'2026-07-15',date:'2026-08-25',creationDate:1767225600,status:0,currency:'ILS',amount:118,vat:18};
const projected=reportDocument(rawDocument);
assert.equal(projected.date,'2026-07-15');
assert.equal(projected.documentDate,'2026-07-15','an undocumented income raw.date cannot override the source reference date');
assert.equal(projected.reportingDate,'2026-07-15');
assert.equal(projected.sourceDocumentDate,'2026-07-15');
assert.equal(projected.createdAt,'2026-01-01T00:00:00.000Z');
assert.equal(projected.updatedAt,'');
assert.equal(reportDocument({...rawDocument,creationDate:1767225600000}).createdAt,'','milliseconds are not accepted as documented Unix seconds');
assert.equal(reportDocument({...rawDocument,creationDate:'1767225600'}).createdAt,'','a malformed timestamp remains explicitly unavailable');
const rawExpense={id:documentId,documentType:305,number:'1',date:'2026-06-28',reportingDate:'2026-07-01',status:30,currency:'ILS',amount:118,vat:18,deductibleAmount:100,deductibleVat:0,creationDate:1767225600,lastUpdateDate:1767312000,accountingClassification:{title:'Category',key:'1310',code:'1300',type:20}};
const expense=reportExpense(rawExpense);
assert.equal(expense.date,'2026-07-01');
assert.equal(expense.documentDate,'2026-06-28');
assert.equal(expense.reportingDate,'2026-07-01');
assert.equal(expense.sourceDocumentDate,'2026-06-28');
assert.equal(expense.updatedAt,'2026-01-02T00:00:00.000Z');
assert.equal(expense.status,30,'edited source status is preserved without inferring accounting inclusion');
assert.equal(expense.categoryKey,'1310');
assert.equal(expense.categoryCode,'1300');
assert.equal(expense.categoryType,20);
assert.equal(expense.deductibleVatCents,0,'zero recoverable VAT is a known value');
assert.equal(reportExpense({...rawExpense,date:'invalid'}).sourceDocumentDate,'','missing invoice date is never invented from the reporting month');

let servedHandler, user={id:owner}, dbFailure=null;
const rows=[], requests=[];
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',MORNING_CLIENT_ID:'test',MORNING_CLIENT_SECRET:'test',MORNING_ENV:'sandbox'};
class Query {
  constructor(){this.filters=[]}
  select(){return this}
  eq(key,value){this.filters.push(row=>row[key]===value);return this}
  limit(){return this}
  maybeSingle(){return this}
  then(resolve,reject){return Promise.resolve({data:rows.find(row=>this.filters.every(filter=>filter(row)))||null,error:dbFailure}).then(resolve,reject)}
}
const fetch=async(url,init={})=>{
  requests.push({url,init});
  if(url.includes('/oauth/token'))return Response.json({access_token:'test',expires_in:3600});
  if(url.endsWith('/documents/search')||url.endsWith('/expenses/search'))return Response.json({items:[],total:0,pages:0,page:1});
  if(url.endsWith('/documents/types?lang=he'))return Response.json([]);
  if(url.endsWith('/download/links'))return Response.json({he:'https://example.org/doc.pdf'});
  if(url==='https://example.org/doc.pdf')return new Response('%PDF-1.4\nmock',{headers:{'Content-Type':'application/pdf'}});
  if(url.includes('/documents/'))return Response.json(rawDocument);
  throw new Error('Unexpected upstream request '+url);
};
const makeContext=()=>vm.createContext({console,Response,Request,URL,AbortController,TextEncoder,crypto:globalThis.crypto,atob:globalThis.atob,setTimeout,clearTimeout,fetch,createMorningReportsHandler,reportPermission,createClient:()=>({from:()=>new Query(),auth:{getUser:async()=>({data:{user}})}}),Deno:{env:{get:key=>env[key]},serve:handler=>{servedHandler=handler}}});
const context=makeContext();
const source=readFileSync(new URL('../netunim-orders/supabase/functions/morning-documents/index.ts',import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'');
vm.runInContext(stripTypeScriptTypes(source),context);
const invoke=(action,extra={})=>servedHandler(new Request('https://example.supabase.co/functions/v1/morning-documents',{method:'POST',headers:{Authorization:'Bearer verified-test-user','Content-Type':'application/json'},body:JSON.stringify({action,document_id:documentId,fromDate:'2026-07-01',toDate:'2026-08-31',source:'documents',...extra})}));
const assertBlocked=async(actions=['search_documents','get_document','document_links','document_pdf','report_page'],extra={})=>{
  for(const action of actions){const before=requests.length,response=await invoke(action,extra);assert.equal(response.status,403,action+' must be forbidden');assert.equal(requests.length,before,action+' must be denied before any Morning fetch')}
};
await assertBlocked();
user={id:owner,user_metadata:{morning_reports:true,morning_documents:true}};
await assertBlocked(undefined,{app_metadata:{morning_reports:true,morning_documents:true},owner_id:other});
user={id:owner,app_metadata:{morning_reports:false,morning_documents:false}};
await assertBlocked();

for(const grant of ['report-secret','document-secret','report-metadata','document-metadata']){
  user={id:owner};delete env.MORNING_REPORT_USER_IDS;delete env.MORNING_DOCUMENT_USER_IDS;
  if(grant==='report-secret')env.MORNING_REPORT_USER_IDS=`${other}, ${owner}`;
  if(grant==='document-secret')env.MORNING_DOCUMENT_USER_IDS=owner;
  if(grant==='report-metadata')user.app_metadata={morning_reports:true};
  if(grant==='document-metadata')user.app_metadata={morning_documents:true};
  for(const action of ['search_documents','get_document','document_links','document_pdf'])assert.equal((await invoke(action)).status,200,grant+' allows '+action);
  assert.equal((await invoke('report_page')).status,grant.startsWith('report')?200:403,'document delegation never grants access to financial reports or expenses');
  assert.equal((await invoke('report_page',{source:'expenses'})).status,grant.startsWith('report')?200:403);
}
user={id:owner};delete env.MORNING_REPORT_USER_IDS;delete env.MORNING_DOCUMENT_USER_IDS;
const ownVerified={owner_id:owner,environment:'sandbox',document_id:documentId,state:'created',verified_at:'2026-07-15T10:00:00.000Z'};
rows.push(ownVerified);
for(const action of ['get_document','document_links','document_pdf'])assert.equal((await invoke(action)).status,200,'an issuer may read their own verified document '+action);
await assertBlocked(['search_documents','report_page']);
await assertBlocked(['get_document','document_links','document_pdf'],{document_id:other,owner_id:owner});
for(const patch of [{owner_id:other},{environment:'production'},{state:'created_unverified'},{state:'pending'},{verified_at:null},{document_id:other}]){
  rows.splice(0,rows.length,{...ownVerified,...patch});
  await assertBlocked(['get_document','document_links','document_pdf']);
}
rows.splice(0,rows.length,ownVerified);dbFailure={code:'PGRST002',status:503,message:'storage unavailable'};
const before=requests.length;
assert.equal((await invoke('document_pdf')).status,503,'ledger lookup outage fails closed with a retriable storage error');
assert.equal(requests.length,before);
dbFailure=null;
assert.equal((await invoke('status')).status,200,'ordinary authenticated issuers retain the existing connection/status route');
env.MORNING_ENV='produciton';env.MORNING_REPORT_USER_IDS=owner;
vm.runInContext(stripTypeScriptTypes(source),makeContext());
for(const action of ['search_documents','get_document','document_links','document_pdf','report_page']){
  const before=requests.length,response=await invoke(action);
  assert.equal(response.status,503,'invalid Morning environment fails closed for '+action);
  assert.equal((await response.json()).code,'morning_environment_invalid');
  assert.equal(requests.length,before,'an environment typo never silently reads production');
}
console.log('PASS Morning server read capabilities: explicit document/report grants, owner verified document scope, forged metadata, failures, all media routes, and source date/classification semantics');
