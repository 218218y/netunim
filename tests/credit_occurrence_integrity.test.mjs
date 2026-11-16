import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
import {creditRestorePreflight} from '../shared/credit-restore-validation.js';
const at='2026-11-16T10:00:00Z';
const tx=(extra={})=>({id:'REUSED',type:'normal',status:'completed',date:'2026-11-10T00:00:00Z',transactionDate:'2026-11-10T00:00:00Z',processedDate:'2026-11-20T00:00:00Z',description:'Merchant A',originalAmount:-100,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS',...extra});
const payload=(rows=[],unassigned=[],pending=[])=>({syncedAt:at,profiles:[{profileId:'P',provider:'max',coreComplete:true,accounts:[{accountNumber:'C',balanceDate:'2026-11-20',pendingStatus:'success',pendingFetchedAt:at,pendingTransactions:pending,unassignedTransactions:unassigned,months:[{month:'2026-11',fetchStatus:'success',fetchedAt:at,transactions:rows}]}]}]});
const seed={cardMappings:{'P:C':{included:true}}};
const bill=sync=>creditBillingRowsData({creditSync:sync},{asOf:'2026-11-16'});
for(const [name,merge] of [['kupa',kupa],['orders',orders]]){
 test(name+' reused issuer IDs preserve distinct occurrences and stable replay totals',()=>{
  const rows=[tx(),tx({description:'Merchant B',chargedAmount:-200,originalAmount:-200})];
  const first=merge(seed,payload(rows));
  assert.equal(bill(first).reduce((sum,r)=>sum+r.amount,0),300);
  const second=merge(first,payload([...rows].reverse()));
  assert.equal(bill(second).reduce((sum,r)=>sum+r.amount,0),300);
  assert.deepEqual(new Set(bill(first).map(r=>r.creditId)),new Set(bill(second).map(r=>r.creditId)));
  assert.equal(creditRestorePreflight({creditSync:first}).ok,true);
 });
 test(name+' an unrelated pending occurrence is not hidden by an old issuer ID',()=>{
  const first=merge(seed,payload([tx({date:'2026-10-10',processedDate:'2026-11-20'})],[],[tx({status:'pending',description:'New purchase',originalAmount:-200,chargedAmount:null,processedDate:null})]));
  assert.equal(bill(first).filter(r=>r.status==='pending').length,1);
 });
 test(name+' an anonymous cross-placement is retained but cannot silently approve a doubled bill',()=>{
  const source=tx({id:'',chargedAmount:-365,originalAmount:-365,processedDate:null});
  const first=merge(seed,payload([{...source,processedDate:'2026-11-20'}],[source]));
  assert.equal(first.profiles[0].coreComplete,false);
  assert.notEqual(bill(first).reduce((sum,r)=>sum+r.amount,0),730);
  assert.equal(creditRestorePreflight({creditSync:first}).ok,false);
  assert.equal(first.profiles[0].accounts[0].unassignedTransactions.length,1);
 });
 test(name+' precise anonymous assignment consumes one source and records its origin',()=>{
  const source=tx({id:'',processedDate:null,transactionTime:'12:34'}),old=merge(seed,payload([],[source]));
  const next=merge(old,payload([{...source,processedDate:'2026-11-20'}]));
  assert.equal(next.errors.length,0);
  assert.equal(next.profiles[0].accounts[0].unassignedTransactions.length,0);
  assert.equal(next.profiles[0].accounts[0].unassignedTransfers.length,1);
 });
 test(name+' late missing conversion enrichment succeeds but a known amount remains immutable',()=>{
  const source=tx({originalAmount:-50,originalCurrency:'USD',chargedAmount:null,chargeAmountStatus:'missing',foreignTransaction:true});
  const old=merge(seed,payload([source])),reported={...source,chargedAmount:-180,chargeAmountStatus:'reported'};
  const next=merge(old,payload([reported]));
  assert.equal(next.errors.length,0);
  assert.equal(bill(next)[0].amount,180);
  const wrong=merge(next,payload([{...reported,chargedAmount:-190}]));
  assert.equal(wrong.profiles[0].coreComplete,false);assert.equal(bill(wrong)[0].amount,180);
 });
}
test('reported money without a billed amount is not a valid ordinary restore',()=>{
 const state={creditSync:{profiles:[{profileId:'P',accounts:[{accountNumber:'C',months:[{month:'2026-11',transactions:[tx({chargedAmount:null,chargeAmountStatus:'reported'})]}]}]}]}};
 assert.equal(creditRestorePreflight(state).ok,false);
});
for(const [name,merge] of [['kupa',kupa],['orders',orders]]){
 test(name+' multiset counts survive identical anonymous rows, pagination mirrors and pending occurrence reuse',()=>{
  const anonymous=tx({id:''});
  const triples=merge(seed,payload([anonymous,anonymous,anonymous]));
  assert.equal(bill(triples).reduce((sum,r)=>sum+r.amount,0),300);
  assert.equal(new Set(bill(triples).map(r=>r.creditId)).size,3);
  // An identical observation with a stable ID is the existing page-mirror contract.
  assert.equal(bill(merge(seed,payload([tx(),tx()]))).length,1);
  const pending=tx({status:'pending',processedDate:null,chargedAmount:null,transactionTime:'12:34'});
  const final={...pending,status:'completed',processedDate:'2026-11-20',chargedAmount:-100};
  // Different ID defeats page-mirror suppression; a consumed final cannot also
  // suppress a second authorization through the ID-independent minute matcher.
  const sync=merge(seed,payload([final],[],[pending,{...pending,id:'OTHER'}]));
  const rows=bill(sync);assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.status==='pending').length,1);
 });
 test(name+' anonymous date-only transfer stays safe and a reviewed single-placement state is recoverable',()=>{
  const source=tx({id:'',processedDate:null}),old=merge(seed,payload([],[source]));
  const next=merge(old,payload([{...source,processedDate:'2026-11-20'}]));
  assert.equal(next.profiles[0].coreComplete,false);assert.equal(next.profiles[0].accounts[0].unassignedTransactions.length,1);
  const reviewed=merge(seed,payload([{...source,processedDate:'2026-11-20'}]));
  assert.equal(creditRestorePreflight({creditSync:reviewed}).ok,true);
  assert.equal(bill(reviewed).reduce((sum,r)=>sum+r.amount,0),100);
 });
}
