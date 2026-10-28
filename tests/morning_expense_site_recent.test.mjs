import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
import {createExpenseLedger} from '../netunim-orders/supabase/functions/morning-expenses/ledger.js';
import {createExpenseRecent} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recent.js';

const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12,'0')}`;
const caps = {version:1,environment:'sandbox',siteRecent:true};
const user = {id:id(1),app_metadata:{morning_expenses_read:true}};
const payload = {number:'00123',documentType:305,date:'2026-08-03',reportingDate:'2026-10-01',currency:'ILS',amount:118,vat:18,
  supplier:{name:'Site supplier',taxId:'123456789'},description:'site intake',accountingClassification:{id:id(5)}};
const stored = {operation_id:id(2),expense_id:id(3),payload,sent_at:'2026-10-28T10:00:00Z',verified_at:'2026-10-28T10:01:00Z'};

test('site recent uses one bounded, owner and environment scoped indexed ledger query', async () => {
  const calls=[];
  const query = new Proxy({}, {get:(_,method) => (...args) => {calls.push([method,...args]);return method==='limit'?Promise.resolve({data:[stored],error:null}):query;}});
  const ledger = createExpenseLedger({from:name=>{assert.equal(name,'morning_expense_operations');return query;}},'sandbox');
  assert.deepEqual(await ledger.recentCreated(user.id),[stored]);
  assert.deepEqual(calls.slice(1),[['eq','owner_id',user.id],['eq','environment','sandbox'],['eq','state','created'],
    ['order','sent_at',{ascending:false}],['order','operation_id',{ascending:false}],['limit',10]]);
});

test('site read authorizes before storage, fences environments and projects only historical display fields', async () => {
  let reads=0;
  const service=createExpenseService({environment:'sandbox',request:()=>assert.fail('no Morning request'),ledger:{recentCreated:async owner=>{
    reads++;assert.equal(owner,user.id);return [{...stored,payload:{...payload,secret:'private',url:'https://signed.example/file'},invoice_identity:'private'}];
  }}});
  assert.equal((await service({id:id(9)},{action:'site_recent',expectedEnvironment:'sandbox'})).status,403);
  assert.equal((await service(user,{action:'site_recent',expectedEnvironment:'production'})).status,409);
  assert.equal((await service(user,{action:'site_recent'})).status,400);assert.equal(reads,0);
  const result=await service(user,{action:'site_recent',expectedEnvironment:'sandbox'});
  assert.equal(reads,1);assert.equal(result.status,200);assert.equal(result.body.items[0].createdAt,stored.sent_at);
  assert.equal(result.body.items[0].grossCents,11800);assert.equal(result.body.items[0].number,'00123');
  assert.ok(!JSON.stringify(result).includes('private')&&!JSON.stringify(result).includes('signed.example'));
});

test('automatic site reads and immediate verified records stay at ten and ignore delayed old snapshots', async () => {
  globalThis.document={querySelector:()=>null};let release,calls=0;
  const row=n=>({id:id(n),kind:'expense',number:'site-'+n,status:10,createdAt:new Date(1700000000000+n*1000).toISOString()});
  const recent=createExpenseRecent({capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),request:async action=>{
    calls++;assert.equal(action,'site_recent');await new Promise(resolve=>release=resolve);
    return {...caps,source:'site',items:[row(1)]};
  }});
  const loading=recent.loadSite();recent.record({verified:true,expenseId:id(20),item:row(20)});release();await loading;
  assert.ok(recent.markup().includes('site-20')&&!recent.markup().includes('site-1<'));assert.equal(calls,1);
  for(let n=21;n<35;n++)recent.record({verified:true,expenseId:id(n),item:row(n)});
  assert.equal((recent.markup().match(/data-expense-recent-id=/g)||[]).length,10);
  assert.equal(recent.record({verified:false,expenseId:id(99),item:row(99)}),false);
  assert.equal(recent.record({verified:true,expenseId:id(98),item:row(99)}),false);
  recent.reset();assert.ok(!recent.markup().includes('site-34'));
});
