import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeExpenseSource,expenseSourceExpected,compareExpenseSource,normalizeExpenseSourceReview} from '../netunim-orders/site/assets/js/core/morning-expense-source.js';
import {expenseNumberPolicy,findExpenseDuplicate} from '../netunim-orders/supabase/functions/morning-expenses/duplicates.js';
import {inspectExpenseSource} from '../netunim-orders/supabase/functions/morning-expenses/source.js';
const id=n=>`aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12,'0')}`;
const payload={documentType:305,number:'00123',date:'2026-10-20',reportingDate:'2026-10-01',currency:'ILS',amount:118,vat:18,pcnClassification:'T',supplier:{taxId:'123456789'}};
const hash=async tax=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('supplier-tax:'+tax))).toString('hex');
const record=patch=>({...payload,id:id(1),status:10,...patch});
test('source metadata is bounded, exact and contains no file name or contents',()=>{
 const valid={sha256:'a'.repeat(64),size:100,contentType:'application/pdf'};
 assert.deepEqual(normalizeExpenseSource({...valid,name:'private.pdf'}),valid);
 for(const patch of [{sha256:'A'.repeat(64)},{size:0},{size:20971521},{contentType:'text/html'}])assert.throws(()=>normalizeExpenseSource({...valid,...patch}));
 assert.equal(normalizeExpenseSource(undefined),null);
 const expected=expenseSourceExpected(payload);
 assert.deepEqual(compareExpenseSource(expected,expected),{missing:[],conflicts:[],matched:true});
 assert.deepEqual(compareExpenseSource({...expected,number:'123'},expected).conflicts,['number']);
 assert.equal(compareExpenseSource({...expected,number:'123'},{...expected,number:'000000123',pcnClassification:'P'}).matched,true);
 assert.throws(()=>normalizeExpenseSourceReview({mode:'extracted',fields:{...expected,grossCents:11900}},expected));
 assert.equal(normalizeExpenseSourceReview({mode:'manual',fields:{},reason:'Source manually compared before approval'},expected).missing.includes('number'),true);
});
test('supplier prefix and zero aliases are comparison-only, scoped to verified profiles',async()=>{
 const profiles=[{id:'roya',issuerTaxHash:await hash('123456789'),verifiedNumberPrefixes:['s']}];
 const policy=await expenseNumberPolicy('123456789','012300','T',profiles);
 assert.equal(policy.canonical('s012300'),'12300');assert.equal(policy.canonical('SI012300'),'SI012300');
 assert.ok(policy.searches.includes('s012300'));assert.ok(policy.searches.includes('12300'));assert.equal(payload.number,'00123');
 const other=await expenseNumberPolicy('999999999','s012300','T',profiles);assert.equal(other.canonical('s012300'),'s012300');
 const numeric=await expenseNumberPolicy('123456789','SI00123','T',[{id:'test',issuerTaxHash:await hash('123456789'),verifiedNumberPrefixes:['SI']}]);
 assert.equal(numeric.canonical('SI00123'),'00123');assert.equal(numeric.canonical('CR00123'),'CR00123');
});
test('duplicate check scans dates across reporting periods and distinguishes supplier snapshots without IDs',async()=>{
 const search=rows=>async path=>{assert.equal(path,'/expenses/search');return {page:1,pageSize:50,total:rows.length,pages:1,items:rows};};
 const same=await findExpenseDuplicate(search([record({reportingDate:'2026-12-01'})]),payload);assert.equal(same.match,'identical');
 assert.equal((await findExpenseDuplicate(search([record({amount:119})]),payload)).match,'identity_conflict');
 assert.equal((await findExpenseDuplicate(search([record({supplier:{taxId:'999999999'}})]),payload)).duplicate,false);
 assert.equal((await findExpenseDuplicate(search([record({supplier:{}})]),payload)).duplicate,true);
 assert.equal((await findExpenseDuplicate(search([record({date:'2025-10-20'})]),payload)).duplicate,false);
 assert.equal((await findExpenseDuplicate(search([record({status:100})]),payload)).duplicate,false);
});
test('duplicate supplier IDs are resolved canonically and unstable pagination fails closed',async()=>{
 const row=record({supplier:{id:id(4)}}),paths=[];
 const request=async path=>{paths.push(path);return path==='/expenses/search'?{page:1,pageSize:50,total:1,pages:1,items:[row]}:{id:id(4),name:'Other supplier',country:'IL',active:true,taxId:'999999999'};};
 assert.equal((await findExpenseDuplicate(request,payload)).duplicate,false);assert.ok(paths.includes('/suppliers/'+id(4)));
 await assert.rejects(()=>findExpenseDuplicate(async()=>({page:1,pageSize:50,total:1050,pages:21,items:[row]}),payload));
});

test('source download failure and mismatching bytes remain distinct without exposing URLs',async()=>{
 const row={state:'created',source_metadata:{sha256:'a'.repeat(64),size:100,contentType:'application/pdf'}};
 const raw={url:'https://api.greeninvoice.co.il/api/v1/expenses/download?secret=private-token'};
 const redirected=await inspectExpenseSource(row,raw,'production',{verifySource:async()=>{throw Error('download failed');}});
 assert.equal(redirected.sourceCheck,'unavailable');assert.equal(redirected.sourceVerified,false);
 assert.ok(!JSON.stringify(redirected).includes('private-token'));assert.ok(!JSON.stringify(redirected).includes('private-name'));
 const mismatch=await inspectExpenseSource(row,raw,'production',{verifySource:async()=>false});
 assert.equal(mismatch.sourceCheck,'mismatch');assert.equal(mismatch.sourcePending,true);
 const offline=await inspectExpenseSource(row,raw,'production',{verifySource:async()=>{throw Error('network unavailable');}});
 assert.equal(offline.sourceCheck,'unavailable');assert.equal(offline.sourcePending,true);
});
