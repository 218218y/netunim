import test from 'node:test';
import assert from 'node:assert/strict';
import {genericMonthlyAccount} from '../netunim-kupa/bank-bridge/credit-monthly-projection.mjs';
import {parseVisaCalMonthData} from '../netunim-kupa/bank-bridge/visa-cal-model.mjs';
import {CAL_TRANSACTION_TYPES} from '../netunim-kupa/bank-bridge/credit-adapter-wire.mjs';
import {normalizeCreditScrapeAccount} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
const options={startDate:new Date('2026-10-01'),futureMonths:1,now:new Date('2026-11-16T12:00:00Z')};
const pending={id:'REUSED',status:'pending',type:'normal',date:'2026-11-01T00:00:00Z',processedDate:'2026-11-01T00:00:00Z',transactionDate:'2026-11-01T00:00:00Z',chargedAmount:0,chargedCurrency:'ILS',originalAmount:-100,originalCurrency:'ILS',description:'Merchant A'};
function verifyBilling(account,expected,provider){
 for(const merge of [kupa,orders]){
  const sync=merge({cardMappings:{'P:C':{included:true}}},{syncedAt:options.now.toISOString(),profiles:[{profileId:'P',provider,coreComplete:true,accounts:[account]}]});
  const rows=creditBillingRowsData({creditSync:sync},{asOf:'2026-11-16'});
  assert.equal(rows.reduce((sum,r)=>sum+r.amount,0),expected);assert.equal(sync.errors.length,0);
 }
}
test('generic provider projection preserves distinct zero-charge authorizations sharing an issuer ID',()=>{
 const account=genericMonthlyAccount({accountNumber:'C',balanceDate:'2026-11-20',txns:[pending,{...pending,originalAmount:-200,description:'Merchant B'}]},'isracard',options);
 assert.equal(account.pendingTransactions.length,2);verifyBilling(account,300,'isracard');
});
test('generic page mirrors stay deduplicated while anonymous multiplicity is preserved',()=>{
 for(const [id,count] of [['REUSED',1],['',2]]){
  const row={...pending,id},account=genericMonthlyAccount({accountNumber:'C',balanceDate:'2026-11-20',txns:[row,row]},'isracard',options);
  assert.equal(account.pendingTransactions.length,count);verifyBilling(account,100*count,'isracard');
 }
});
const raw={trnIntId:'REUSED',trnTypeCode:CAL_TRANSACTION_TYPES.regular,trnPurchaseDate:'2026-11-01T10:00:00',trnAmt:100,trnCurrencySymbol:'₪',debCrdDate:'2026-11-10',amtBeforeConvAndIndex:100,debCrdCurrencySymbol:'₪',merchantName:'Merchant A'};
function cal(transactions,total){
 const data={statusCode:1,result:{bankAccounts:[{debitDates:[{date:'2026-11-10',totalDebits:[{amount:total,currencySymbol:'₪'}],transactions}]}]}};
 const rows=parseVisaCalMonthData(data);
 return normalizeCreditScrapeAccount({accountNumber:'C',txns:rows},'visaCal');
}
for(const amount of [100,200])test('CAL uses every distinct purchase witness in its statement sum: second amount '+amount,()=>{
 const account=cal([raw,{...raw,trnAmt:amount,amtBeforeConvAndIndex:amount,merchantName:'Merchant B'}],100+amount);
 assert.equal(account.txns.filter(t=>t.type==='statement_adjustment').length,0);assert.equal(account.txns.length,2);verifyBilling(account,100+amount,'visaCal');
});
test('CAL informational blank charges use the full canonical sum despite reused IDs',()=>{
 const account=cal([raw,{...raw,trnAmt:200,amtBeforeConvAndIndex:200,merchantName:'Merchant B'},{...raw,trnIntId:'waived',trnAmt:40,amtBeforeConvAndIndex:null,merchantName:'Informational charge'}],300);
 assert.equal(account.txns.find(t=>t.id==='waived').chargeAmountStatus,'not_billed');verifyBilling(account,300,'visaCal');
});
test('CAL exact page mirrors do not introduce a statement adjustment or extra charge',()=>{
 const account=cal([raw,raw],100);assert.equal(account.txns.length,1);verifyBilling(account,100,'visaCal');
});
test('CAL retains anonymous same-evidence multiplicity and explicit refund signs',()=>{
 const anonymous={...raw,trnIntId:''},account=cal([anonymous,anonymous],200);assert.equal(account.txns.length,2);verifyBilling(account,200,'visaCal');
 const refund=cal([raw,{...raw,trnTypeCode:CAL_TRANSACTION_TYPES.credit,trnAmt:25,amtBeforeConvAndIndex:-25,merchantName:'Merchant refund'}],75);
 assert.equal(refund.txns.length,2);verifyBilling(refund,75,'visaCal');
});
