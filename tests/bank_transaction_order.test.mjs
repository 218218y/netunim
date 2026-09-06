import assert from 'node:assert/strict';
import {bankSmartHistoryRows} from '../shared/bank-transaction-order.js';

const tx=(id,{date='2026-09-04T12:00:00.000Z',processedDate=date,amount=0,balanceAfter=0,status='completed',presenceState='present',missingAcknowledgedAt=null,archiveId=1}={})=>({id,date,processedDate,amount,balanceAfter,status,presenceState,missingAcknowledgedAt,archiveId});

// Regression from the 2026-09-06 screenshots. The archive happened to return same-day rows in
// id order, while the direct bank snapshot retained the bank's real sequence. balanceAfter is an
// authoritative bank field, so reordering the rows makes a correct balance chain look corrupted.
const pendingDebit=tx('pending-debit',{processedDate:'2026-09-06T12:00:00.000Z',amount:-4540,balanceAfter:105390.34,status:'pending',archiveId:103});
const pendingCredit=tx('pending-credit',{processedDate:'2026-09-06T12:00:00.000Z',amount:2600,balanceAfter:109930.34,status:'pending',archiveId:102});
const debit=tx('debit-20000',{amount:-20000,balanceAfter:107330.34,archiveId:101});
const credit5140=tx('credit-5140',{amount:5140,balanceAfter:127330.34,archiveId:105});
const credit1000=tx('credit-1000',{amount:1000,balanceAfter:122190.34,archiveId:106});
const archiveOrder=[credit1000,credit5140,pendingDebit,pendingCredit,debit];
const directOrder=[pendingDebit,pendingCredit,debit,credit5140,credit1000];
const ordered=bankSmartHistoryRows(archiveOrder,{directTransactions:directOrder});
assert.deepEqual(ordered.map(row=>row.id),directOrder.map(row=>row.id),'smart history must preserve the complete direct-bank order for same-day rows instead of archive insertion order');
for(let i=0;i<ordered.length-1;i++){
  const newer=ordered[i],older=ordered[i+1],expectedPrior=Number((newer.balanceAfter-newer.amount).toFixed(2));
  assert.equal(Number(older.balanceAfter.toFixed(2)),expectedPrior,`balanceAfter continuity must hold between ${newer.id} and ${older.id}`);
}

// Pending is a bank-state priority, not an archive timestamp. If a row is not present in the last
// complete snapshot (for example after a partial refresh), it must still not be pushed behind
// settled movements merely because its event date is older.
const olderPending=tx('older-pending',{date:'2026-09-03T12:00:00.000Z',processedDate:'2026-09-06T12:00:00.000Z',status:'pending',archiveId:2});
const newerSettled=tx('newer-settled',{date:'2026-09-05T12:00:00.000Z',processedDate:'2026-09-05T12:00:00.000Z',status:'completed',archiveId:3});
assert.deepEqual(bankSmartHistoryRows([newerSettled,olderPending]).map(row=>row.id),['older-pending','newer-settled'],'pending rows stay above settled history even without a snapshot rank');

// Reconciliation warnings intentionally outrank the financial sequence until reviewed. This
// preserves the v34 missing-transaction UX while the rest of the rows keep bank order.
const missing=tx('missing',{date:'2026-08-31T12:00:00.000Z',presenceState:'missing',archiveId:4});
const withWarning=bankSmartHistoryRows([pendingDebit,missing],{directTransactions:[pendingDebit],isMissingActive:row=>row.presenceState==='missing'&&!row.missingAcknowledgedAt});
assert.equal(withWarning[0].id,'missing','active missing warnings remain pinned above the normal bank sequence');

console.log('PASS bank transaction order: pending/source-order reconciliation preserves authoritative balanceAfter sequence');
