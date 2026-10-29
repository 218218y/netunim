import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openExpenseDocument} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-document.js';
import {createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
const id='aaaaaaaa-aaaa-4aaa-aaaa-000000000001',url='https://www.greeninvoice.co.il/api/v1/expenses/download?private=temporary';
test('source link is read-only, environment scoped, canonical and never returned by normal list records',async()=>{
 let reads=0;const service=createExpenseService({environment:'production',request:async path=>{reads++;assert.equal(path,'/expenses/'+id);return {id,url};}});
 assert.equal((await service({id},{action:'source_link',id,expectedEnvironment:'production'})).status,403);
 const user={id,app_metadata:{morning_expenses_read:true}};
 assert.equal((await service(user,{action:'source_link',id,expectedEnvironment:'sandbox'})).status,409);assert.equal(reads,0);
 assert.equal((await service(user,{action:'source_link',id,expectedEnvironment:'production'})).body.url,url);assert.equal(reads,1);
 const missing=createExpenseService({environment:'production',request:async()=>({id})});assert.equal((await missing(user,{action:'source_link',id,expectedEnvironment:'production'})).status,404);
});
test('popup reserves the user gesture, cuts opener, validates URL and closes on account change',async()=>{
 let destination='',closed=0,message='';const popup={opener:{},document:{body:{}},location:{replace:value=>{destination=value;}},close:()=>{closed++;}};
 const options={id,environment:'production',open:()=>popup,check:()=>{},report:value=>{message=value;},request:async()=>({url})};
 assert.equal(await openExpenseDocument(options),true);assert.equal(popup.opener,null);assert.equal(destination,url);
 assert.equal(await openExpenseDocument({...options,request:async()=>({url:'https://attacker.invalid'})}),false);assert.equal(closed,1);assert.ok(message);
 assert.equal(await openExpenseDocument({...options,check:()=>{throw Error('old account');}}),false);assert.equal(closed,2);
 assert.equal(await openExpenseDocument({...options,open:()=>null}),false);
});
