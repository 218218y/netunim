import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCreditMonthSnapshot} from '../shared/credit-month-integrity.js';
import {normalizeCreditSync as kupa,mergeCreditSyncResult as mergeKupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as orders,mergeCreditSyncResult as mergeOrders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
const tx={id:'posted-early',type:'normal',status:'completed',date:'2026-11-10',processedDate:'2026-11-20',chargedAmount:-365,chargedCurrency:'ILS',originalAmount:-365,originalCurrency:'ILS'};
const month={month:'2026-11',tier:'core',status:'fresh',fetchStatus:'success',fetchedAt:'2026-11-16T10:00:00Z',transactions:[tx]};
for(const [name,normalize,merge] of [['kupa',kupa,mergeKupa],['orders',orders,mergeOrders]])test(name+' partial recovery retains completed charge before its future billing day',()=>{
 const profile={profileId:'P',provider:'max',accounts:[{accountNumber:'C',months:[month]}]};
 const before=normalize({version:4,profiles:[profile]});
 const after=merge(before,{profiles:[{...profile,coreComplete:true,accounts:[{accountNumber:'C',months:[{...month,transactions:[]}]}]}],errors:[]});
 const retained=after.profiles[0].accounts[0].months[0];
 assert.equal(retained.transactions.length,1);assert.equal(retained.fetchStatus,'schema_error');
 assert.equal(after.profiles[0].coreComplete,false);assert.ok(after.errors.some(error=>error.code==='CREDIT_HISTORICAL_MONTH_REGRESSION'));
});
for(const billing of ['2026-11-20','2027-01-20','2024-02-29'])test('completed evidence is retained irrespective of billing date '+billing,()=>{
 const prior={...month,fetchedAt:'2024-01-01T00:00:00Z',month:billing.slice(0,7),transactions:[{...tx,processedDate:billing}]};
 const after=mergeCreditMonthSnapshot(prior,{...prior,transactions:[]},'2024-01-01T00:00:00Z');
 assert.equal(after.transactions.length,1);assert.equal(after.fetchStatus,'schema_error');
});
test('pending authorizations may expire, explicit refund additions preserve posted evidence',()=>{
 const pending={...month,transactions:[{...tx,status:'pending'}]};
 assert.equal(mergeCreditMonthSnapshot(pending,{...pending,transactions:[]},'2026-11-16T11:00:00Z').transactions.length,0);
 const refund={...tx,id:'refund',chargedAmount:365,originalAmount:365};
 assert.equal(mergeCreditMonthSnapshot(month,{...month,transactions:[tx,refund]},'2026-11-16T11:00:00Z').transactions.length,2);
});
