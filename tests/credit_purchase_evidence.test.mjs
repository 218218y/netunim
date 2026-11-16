import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditVersionDiff} from '../shared/finance-history-model.js';
const at='2026-11-16T10:00:00Z';
const a={id:'REUSED',type:'normal',status:'completed',date:'2026-09-01T00:00:00.000Z',processedDate:'2026-11-20T00:00:00.000Z',transactionDate:'2026-09-02T00:00:00.000Z',transactionTime:'10:01',description:'Merchant A',originalAmount:-100,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS'};
const b={...a,description:'Merchant B',transactionDate:'2026-09-03T00:00:00.000Z',transactionTime:'11:02'};
const variants=[{description:'Merchant C'},{transactionDate:'2026-09-04T00:00:00.000Z'},{transactionTime:'12:03'},{description:'Merchant C',transactionDate:'2026-09-04T00:00:00.000Z',transactionTime:'12:03'}];
const seed={cardMappings:{'P:C':{included:true,account:'עסקי'}}};
const payload=(rows,unassigned=false,month='2026-11')=>({syncedAt:at,profiles:[{profileId:'P',provider:'max',coreComplete:true,accounts:[{accountNumber:'C',balanceDate:month+'-20',months:[{month,fetchStatus:'success',fetchedAt:at,transactions:unassigned?[]:rows.map(t=>({...t,processedDate:month+'-20T00:00:00.000Z'}))}],unassignedTransactions:unassigned?rows.map(t=>({...t,processedDate:null})):[]}]}]});
for(const [name,merge] of [['kupa',kupa],['orders',orders]])for(const unassigned of [false,true])test(name+' blocks equal-money source replacement in '+(unassigned?'unassigned':'protected month'),()=>{
 for(const month of ['2026-10','2026-11','2027-01'])for(const changed of variants){
  const old=merge(seed,payload([a,b],unassigned,month)),wire=JSON.stringify(old),next=merge(old,payload([b,{...a,...changed}],unassigned,month));
  const account=next.profiles[0].accounts[0],rows=unassigned?account.unassignedTransactions:account.months[0].transactions;
  assert.equal(next.profiles[0].coreComplete,false);assert.ok(next.errors.some(e=>e.code===(unassigned?'CREDIT_UNASSIGNED_REGRESSION':'CREDIT_HISTORICAL_MONTH_REGRESSION')));
  assert.deepEqual(rows,unassigned?old.profiles[0].accounts[0].unassignedTransactions:old.profiles[0].accounts[0].months[0].transactions);
  assert.equal(JSON.stringify(old),wire);
  assert.equal(merge(old,payload([b,a],unassigned,month)).errors.length,0,'unchanged multiset/order remains accepted');
 }
});
test('Finance comparison exposes purchase-source replacements with unchanged money and settings',()=>{
 for(const unassigned of [false,true])for(const changed of variants){
  const before={creditSync:kupa(seed,payload([a,b],unassigned))},after={creditSync:kupa(seed,payload([b,{...a,...changed}],unassigned))};
  const diff=creditVersionDiff(before,after,{asOf:'2026-11-16'});
  assert.equal(diff.calculatedChanged,false);assert.equal(diff.settingChanges.length,0);
  assert.equal(diff.changes.length,2);assert.equal(diff.changes.filter(r=>r.kind==='removed').length,1);assert.equal(diff.changes.filter(r=>r.kind==='added').length,1);
 }
});
