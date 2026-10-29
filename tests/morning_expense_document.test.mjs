import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
import {createExpenseHandler} from '../netunim-orders/supabase/functions/morning-expenses/handler.js';
import {readExpenseSource} from '../netunim-orders/supabase/functions/morning-expenses/source-file.js';
import {createExpenseRequest} from '../netunim-orders/site/assets/js/integrations/morning-expenses.js';
const id='aaaaaaaa-aaaa-4aaa-aaaa-000000000001',url='https://www.greeninvoice.co.il/api/v1/expenses/download?private=temporary';
test('source link is read-only, environment scoped, canonical and never returned by normal list records',async()=>{
 let reads=0;const service=createExpenseService({environment:'production',request:async path=>{reads++;assert.equal(path,'/expenses/'+id);return {id,url};}});
 assert.equal((await service({id},{action:'source_link',id,expectedEnvironment:'production'})).status,403);
 const user={id,app_metadata:{morning_expenses_read:true}};
 assert.equal((await service(user,{action:'source_link',id,expectedEnvironment:'sandbox'})).status,409);assert.equal(reads,0);
 assert.equal((await service(user,{action:'source_link',id,expectedEnvironment:'production'})).body.url,url);assert.equal(reads,1);
 const missing=createExpenseService({environment:'production',request:async()=>({id})});assert.equal((await missing(user,{action:'source_link',id,expectedEnvironment:'production'})).status,404);
});
test('source viewer relays canonical bytes with auth, environment, inline/no-store and no financial write',async()=>{
 const bytes='%PDF-1.4 synthetic source';let reads=0,downloads=0;
 const service=createExpenseService({environment:'production',request:async(path,options)=>{assert.equal(path,'/expenses/'+id);assert.equal(options.method,'GET');reads++;return {id,url};},
  sourceFetch:async(target,options)=>{downloads++;assert.equal(target,url);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment'}});}});
 const user={id,app_metadata:{morning_expenses_read:true}};
 const handler=createExpenseHandler({getUser:async()=>user,service});
 const call=body=>handler(new Request('https://service.invalid',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)}));
 const response=await call({action:'source_file',id,expectedEnvironment:'production'});
 assert.equal(response.headers.get('Content-Disposition'),'inline');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Morning-Environment'),'production');assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.equal(await response.text(),bytes);
 const client=createExpenseRequest({supaFetch:async(path,options)=>{assert.equal(options.networkRetry,false);return call(JSON.parse(options.body));}});
 const value=await client('source_file',{id,expectedEnvironment:'production'},()=>{});assert.equal(value.environment,'production');assert.equal(await value.file.text(),bytes);
 assert.equal((await call({action:'source_file',id,expectedEnvironment:'sandbox'})).status,409);
 assert.equal((await service({id},{action:'source_file',id,expectedEnvironment:'production'})).status,403);
 assert.equal(reads,2);assert.equal(downloads,2);
});

test('source byte relay rejects unsafe targets, oversized, truncated, non-document and stalled sources',async()=>{
 let calls=0;const fetch=async()=>{calls++;return new Response('%PDF-1.4 safe');};
 for(const bad of ['https://attacker.invalid/api/v1/expenses/download','https://www.greeninvoice.co.il/wrong','https://www.greeninvoice.co.il/api/v1/expenses/download#x','https://user@www.greeninvoice.co.il/api/v1/expenses/download'])await assert.rejects(readExpenseSource({url:bad},'production',{fetch}));
 assert.equal(calls,0);
 await assert.rejects(readExpenseSource({url},'production',{fetch:async()=>new Response('%PDF-1.4',{headers:{'Content-Length':'20971521'}})}),/size/);
 await assert.rejects(readExpenseSource({url},'production',{fetch:async()=>new Response('%PDF-1.4',{headers:{'Content-Length':'100'}})}),/size/);
 await assert.rejects(readExpenseSource({url},'production',{fetch:async()=>new Response('<script>bad</script>')}),/type/);
 await assert.rejects(readExpenseSource({url},'production',{fetch:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20971521));}}))}),/size/);
 await assert.rejects(readExpenseSource({url},'production',{timeoutMs:10,fetch:async()=>new Response(new ReadableStream({start(){}}))}),/timeout/);
 await assert.rejects(readExpenseSource({url},'production',{timeoutMs:10,fetch:()=>new Promise(()=>{})}),/timeout/);
});
