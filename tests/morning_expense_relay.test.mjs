import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseUpload} from '../netunim-orders/supabase/functions/morning-expenses/upload.js';
import {createExpenseHandler} from '../netunim-orders/supabase/functions/morning-expenses/handler.js';
import {createExpenseRequest} from '../netunim-orders/site/assets/js/integrations/morning-expenses.js';
import {approveExpenseDraft} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-submit.js';
import {validateExpenseFile} from '../netunim-orders/site/assets/js/platform/morning-expense-files.js';
const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0');
async function fixture(){
 const file=new Blob(['%PDF-1.4 relay original'],{type:'application/pdf'}),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())).toString('hex');
 const user={id:id(1),app_metadata:{morning_expenses_write:true}},payload={documentType:305,number:'0011',date:'2026-10-20',reportingDate:'2026-10-01',currency:'ILS',amount:118,vat:18,pcnClassification:'T',supplier:{taxId:'123456789'},accountingClassification:{id:id(4)}};
 const row={operation_id:id(2),expense_id:id(3),state:'created',verified_at:'2026-10-20',file_state:'not_started',payload,
 source_metadata:{sha256,size:file.size,contentType:file.type},source_review:{mode:'extracted'}};
 let time=1000000,sends=0,linked=false,fail=false;const paths=[];
 const ledger={get:async()=>structuredClone(row),fileTransition:async(_,before,patch)=>{
 if(before.file_state!==row.file_state||before.file_generation!==row.file_generation)return null;Object.assign(row,patch);return structuredClone(row);}};
 const bucket='sandbox-file-upload-service-uploaded';
 const options={environment:'sandbox',enabled:true,ledger,now:()=>time,verifySource:async()=>true,request:async(path,init)=>{
  paths.push({path,method:init.method});assert.equal(init.method,'GET','relay attempted a financial POST');
  if(path.startsWith('/expenses/'))return {...payload,id:row.expense_id,status:10,data:{pcnTaxId:payload.supplier.taxId,pcnClassification:'T'},...(linked?{url:'https://sandbox.d.greeninvoice.co.il/api/v1/expenses/download?id=secret'}:{})};
  return {url:'https://s3.eu-west-1.amazonaws.com/'+bucket,maxFileSize:20971520,fields:{bucket,key:'synthetic',Policy:'policy','X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':'cred','X-Amz-Date':'date','X-Amz-Security-Token':'token','X-Amz-Signature':'signature','x-amz-meta-file-context':'expense','x-amz-meta-file-data':JSON.stringify({id:row.expense_id,source:5,state:'expense'})}};
 },sendSource:async(_,init)=>{sends++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal([...init.body.keys()].at(-1),'file');assert.equal(Buffer.from(await init.body.get('file').arrayBuffer()).toString(),'%PDF-1.4 relay original');if(fail)throw TypeError('ALPN failure');return new Response(null,{status:204});}};
 const uploader=createExpenseUpload(options),call=extra=>uploader.handle(user,{action:'upload_source',operationId:row.operation_id,file,...extra});
 return {row,user,file,call,options,paths,sends:()=>sends,advance:()=>{time+=120001;},link:()=>{linked=true;},fail:value=>{fail=value;}};
}
test('server receives bound bytes and relays once, never creating an expense or exposing a signed form',async()=>{
 const f=await fixture(),r=await f.call();assert.equal(r.status,200);assert.equal(r.body.deliveryAccepted,true);assert.equal(f.sends(),1);
 assert.equal(f.row.file_state,'file_accepted');assert.ok(!JSON.stringify(r).includes('signature'));assert.equal(f.row.expense_id,id(3));
});
test('uncertain delivery does not auto replay; explicit expired-generation retry is identical-source only and audited',async()=>{
 const f=await fixture();f.fail(true);assert.equal((await f.call()).status,503);const generation=f.row.file_generation;
 assert.equal((await f.call()).status,409);assert.equal((await f.call({retryGeneration:generation})).status,409);assert.equal(f.sends(),1);
 f.advance();assert.equal((await f.call({retryGeneration:'other'})).status,409);
 assert.equal((await f.call({retryGeneration:generation,file:new Blob(['wrong'],{type:'application/pdf'})})).status,409);
 f.fail(false);assert.equal((await f.call({retryGeneration:generation})).status,200);assert.equal(f.sends(),2);
 assert.equal(f.row.source_review.retryCount,1);assert.equal(f.row.source_review.previousGeneration,generation);assert.ok(f.row.source_review.retryConsentAt);
 assert.equal(f.row.expense_id,id(3));
});
test('concurrent relay calls deliver at most one file; a canonical existing source is never replaced',async()=>{
 const f=await fixture();await Promise.all([f.call(),f.call(),f.call()]);assert.equal(f.sends(),1);
 f.link();const r=await f.call();assert.equal(r.body.sourceVerified,true);assert.equal(f.sends(),1);
 const closed=createExpenseUpload({...f.options,enabled:false});assert.equal((await closed.handle(f.user,{action:'upload_source',operationId:f.row.operation_id,file:f.file})).status,403);
});
test('binary endpoint authenticates first, enforces stream size and only accepts supported file content types',async()=>{
 let calls=0;const handler=createExpenseHandler({getUser:async token=>token==='valid'?{id:id(1)}:null,service:async(_,body)=>{calls++;assert.equal(body.action,'upload_source');assert.equal(body.file.size,8);return {status:200,body:{ok:true}};}});
 const req=(body,type='application/pdf',token='valid')=>new Request('https://example.invalid?'+new URLSearchParams({action:'upload_source',operationId:id(2),expectedEnvironment:'sandbox'}),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':type},body});
 assert.equal((await handler(req('12345678'))).status,200);assert.equal((await handler(req('12345678','application/pdf','bad'))).status,401);
 assert.equal((await handler(req('12345678','text/html'))).status,400);assert.equal((await handler(req(new Uint8Array(20971521)))).status,413);assert.equal(calls,1);
});
test('client binary relay keeps auth scope, raw bytes and no-network-retry semantics',async()=>{
 const blob=new Blob(['%PDF-1.4'],{type:'application/pdf'});let n=0;
 const request=createExpenseRequest({supaFetch:async(path,init)=>{n++;assert.ok(path.includes('action=upload_source'));assert.equal(init.body,blob);assert.equal(init.networkRetry,false);assert.equal(init.headers['Content-Type'],'application/pdf');init.assertRequestScope();return Response.json({ok:true});}});
 await request('upload_source',{operationId:id(2),expectedEnvironment:'sandbox',file:blob},()=>{});assert.equal(n,1);
});
test('file selection owns all bytes, independent of later disk-file read failures',async()=>{
 const original=new File(['%PDF-1.4 retained'],'original.pdf',{type:'application/pdf'}),saved=await validateExpenseFile(original);
 original.arrayBuffer=async()=>{throw new DOMException('moved','NotReadableError');};
 assert.notEqual(saved.file,original);assert.equal(await saved.file.text(),'%PDF-1.4 retained');
});
test('approval is immediate and generic; cancellation sends no preflight requests',async()=>{
 const calls=[],draft={supplierId:id(3),classificationExpenseId:id(4),number:'0012',documentType:305,date:'2026-10-20',reportingDate:'2026-10-01',reportingPeriod:'2026-09',net:'100.00',vat:'18.00',gross:'118.00',pcnClassification:'T',description:''};
 const options={draft,classification:{id:id(4)},supplier:{taxId:'123456789'},operationId:id(2),today:'2026-10-29',capabilities:{environment:'production'},
 check:()=>{},currentSurface:()=>true,preflight:async()=>calls.push('preflight'),prepareSource:async()=>{calls.push('source');return null;},verifySource:async()=>{},request:async()=>assert.fail('request'),progress:()=>{},
 confirmDialog:async(_,message)=>{calls.push('confirm');assert.ok(message.includes('בדקת'));assert.ok(!message.includes('0012'));return false;}};
 assert.equal(await approveExpenseDraft(options),null);assert.deepEqual(calls,['confirm']);
});
