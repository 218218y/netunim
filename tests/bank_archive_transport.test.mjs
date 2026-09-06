import assert from 'node:assert/strict';
import {createCloudTransport as createKupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createCloudTransport as createOrdersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';

function jsonResponse(body,{ok=true}={}){
  const text=JSON.stringify(body);
  return {ok,async json(){return body},async text(){return text}};
}

const sourceRows=[
  {date:'2026-08-30T09:00:00.000Z',processedDate:'2026-08-30T09:00:00.000Z',amount:100,description:'זיכוי',memo:'א',bankReference:'777',bankSerial:'1',status:'completed'},
  {date:'2026-08-29T09:00:00.000Z',processedDate:'2026-08-29T09:00:00.000Z',amount:100,description:'זיכוי',memo:'א',bankReference:'777',bankSerial:'1',status:'completed'},
  {date:'2026-08-28T09:00:00.000Z',processedDate:'2026-08-28T09:00:00.000Z',amount:55,description:'פעולה',memo:'זהה',bankReference:'',bankSerial:'0',status:'pending',checkDetails:null},
  {date:'2026-08-28T09:00:00.000Z',processedDate:'2026-08-28T09:00:00.000Z',amount:55,description:'פעולה',memo:'זהה',bankReference:'',bankSerial:'0',status:'pending',checkDetails:null},
];

let mergePayload=null;
const pageRequests=[];
const archiveRow=i=>({merge_key:`k${i}`,transaction_date:'2026-08-01T09:00:00.000Z',processed_date:'2026-08-01T09:00:00.000Z',amount:'1',currency:'ILS',description:'x',memo:'',party_name:'',party_headline:'',message_headline:'',message_detail:'',status:'completed',balance_after:null,bank_reference:String(i),bank_serial:String(i),activity_type_code:1,cheque:false,check_details:null,alert_acknowledgements:i===0?{returned_cheque:'2026-09-06T01:00:00.000Z'}:{}});
const kupaFetch=async(path,options={})=>{
  if(path.includes('/rpc/merge_bank_transactions')){mergePayload=JSON.parse(options.body);return jsonResponse([{inserted_count:4,updated_count:0,total_count:4}])}
  if(path.includes('/bank_transactions?')){
    pageRequests.push(path);
    const offset=Number(new URL('https://local.invalid'+path).searchParams.get('offset')||0);
    return jsonResponse(offset===0?Array.from({length:1000},(_,i)=>archiveRow(i)):offset===1000?[archiveRow(1000),archiveRow(1001)]:[]);
  }
  throw new Error('unexpected request '+path);
};
const kupa=createKupaTransport({session:{cloudDocumentName:'main'},supaRest:kupaFetch});
await kupa.mergeBankTransactions('12-655-1','business',sourceRows);
assert.equal(mergePayload.p_transactions.length,4);
const keys=mergePayload.p_transactions.map(x=>x.mergeKey);
assert.equal(new Set(keys).size,4,'every source row receives a unique merge key');
assert.match(keys[0],/^serial:2026-08-30:1:100$/);
assert.match(keys[1],/^serial:2026-08-29:1:100$/,'same serial/reference on another day is not collapsed');
assert.match(keys[2],/:1$/);
assert.match(keys[3],/:2$/,'indistinguishable fallback rows get stable occurrence suffixes within one bank response');

const archive=await kupa.readBankTransactions('12-655-1','business',{days:370,maxRows:3000});
assert.equal(archive.length,1002,'archive reader paginates beyond the 1000-row PostgREST page');
assert.equal(archive[0].alertAcknowledgements.returned_cheque,'2026-09-06T01:00:00.000Z','archive reader preserves per-alert durable acknowledgements');
assert.equal(pageRequests.length,2);
assert.match(pageRequests[0],/account_role=eq\.business/);
assert.match(pageRequests[0],/offset=0/);
assert.match(pageRequests[1],/offset=1000/);
pageRequests.length=0;
const allArchive=await kupa.readBankTransactions('12-655-1','business',{days:null,maxRows:3000});
assert.equal(allArchive.length,1002,'all-years archive reader keeps deterministic pagination');
assert.equal(pageRequests.some(path=>path.includes('transaction_date=gte.')),false,'all-years archive reader does not impose the legacy 370-day cutoff');

let ordersMerge=null;
const orders=createOrdersTransport({supaFetch:async(path,options={})=>{if(path.includes('/rpc/merge_bank_transactions')){ordersMerge=JSON.parse(options.body);return jsonResponse([{inserted_count:4,updated_count:0,total_count:4}])}throw new Error('unexpected request '+path)}});
await orders.mergeBankTransactions('12-655-1','business',sourceRows);
assert.deepEqual(ordersMerge.p_transactions.map(x=>x.mergeKey),keys,'Kupa and Orders derive byte-identical archive identities');



const reconciliationCalls=[];
const snapshotRow={snapshot_at:'2026-09-06T02:00:00.000Z',coverage_from:'2026-08-08',coverage_to:'2026-09-06',transaction_count:1,transactions:[{mergeKey:'snapshot-1',date:'2026-09-06T01:00:00.000Z',amount:500,description:'הפקדת שיק',cheque:true}]};
const reconciliationFetch=async(path,options={})=>{
  if(path.includes('/rpc/sync_bank_transactions_snapshot')){reconciliationCalls.push({path,body:JSON.parse(options.body)});return jsonResponse([{inserted_count:1,updated_count:0,total_count:1,missing_count:0,active_missing_count:0,snapshot_stored:true,baseline_created:true}])}
  if(path.includes('/bank_transaction_snapshots?'))return jsonResponse([snapshotRow]);
  if(path.includes('/rpc/acknowledge_bank_transaction_missing')){reconciliationCalls.push({path,body:JSON.parse(options.body)});return jsonResponse([{transaction_id:77,acknowledged_at:'2026-09-06T02:05:00.000Z'}])}
  if(path.includes('/rpc/acknowledge_bank_transaction_alert')){reconciliationCalls.push({path,body:JSON.parse(options.body)});return jsonResponse([{transaction_id:77,alert_kind:'returned_cheque',acknowledged_at:'2026-09-06T02:06:00.000Z'}])}
  throw new Error('unexpected reconciliation request '+path);
};
const kupaReconciliation=createKupaTransport({session:{cloudDocumentName:'main'},supaRest:reconciliationFetch});
const completeResult=await kupaReconciliation.syncBankTransactionsSnapshot('12-655-1','business',[sourceRows[0]],{snapshotAt:'2026-09-06T02:00:00.000Z',coverage:{complete:true,from:'2026-08-08',to:'2026-09-06',days:30,warning:''},complete:true});
assert.equal(completeResult.complete,true,'a proven-complete connector read is allowed to drive reconciliation');
assert.equal(reconciliationCalls.at(-1).body.p_complete,true);
assert.equal(reconciliationCalls.at(-1).body.p_coverage_from,'2026-08-08');
assert.equal(reconciliationCalls.at(-1).body.p_coverage_to,'2026-09-06');
await kupaReconciliation.syncBankTransactionsSnapshot('12-655-1','business',[],{snapshotAt:'2026-09-06T03:00:00.000Z',coverage:{complete:true,from:'2026-08-08',to:'2026-09-06',days:30,warning:'transactions failed'},complete:true});
assert.equal(reconciliationCalls.at(-1).body.p_complete,false,'a transaction warning fail-closes absence reconciliation');
assert.equal(reconciliationCalls.at(-1).body.p_coverage_from,null,'partial reads cannot claim a coverage window');
assert.equal(reconciliationCalls.at(-1).body.p_coverage_to,null,'partial reads cannot claim a coverage window');
const directSnapshot=await kupaReconciliation.readBankTransactionSnapshot('12-655-1','business');
assert.equal(directSnapshot.snapshotAt,snapshotRow.snapshot_at);
assert.equal(directSnapshot.transactions[0].id,'snapshot-1','direct-bank view is reconstructed from the durable complete snapshot payload');
await kupaReconciliation.acknowledgeBankTransactionMissing(77);
assert.equal(reconciliationCalls.at(-1).body.p_transaction_id,77,'manual review acknowledges the persistent missing incident by archive row id');
await kupaReconciliation.acknowledgeBankTransactionAlert(77,'returned_cheque');
assert.deepEqual(reconciliationCalls.at(-1).body,{p_transaction_id:77,p_alert_kind:'returned_cheque'},'returned-cheque dismissal is persisted separately from missing reconciliation');

let ordersSnapshotPayload=null;
const ordersReconciliationCalls=[];
const ordersReconciliation=createOrdersTransport({supaFetch:async(path,options={})=>{
  if(path.includes('/rpc/sync_bank_transactions_snapshot')){ordersSnapshotPayload=JSON.parse(options.body);ordersReconciliationCalls.push({path,body:ordersSnapshotPayload});return jsonResponse([{inserted_count:1,updated_count:0,total_count:1}])}
  if(path.includes('/bank_transaction_snapshots?'))return jsonResponse([snapshotRow]);
  if(path.includes('/rpc/acknowledge_bank_transaction_missing')){ordersReconciliationCalls.push({path,body:JSON.parse(options.body)});return jsonResponse([{transaction_id:77,acknowledged_at:'2026-09-06T02:05:00.000Z'}])}
  if(path.includes('/rpc/acknowledge_bank_transaction_alert')){ordersReconciliationCalls.push({path,body:JSON.parse(options.body)});return jsonResponse([{transaction_id:77,alert_kind:'returned_cheque',acknowledged_at:'2026-09-06T02:06:00.000Z'}])}
  throw new Error('unexpected request '+path)
}});
await ordersReconciliation.syncBankTransactionsSnapshot('12-655-1','business',[sourceRows[0]],{snapshotAt:'2026-09-06T02:00:00.000Z',coverage:{complete:true,from:'2026-08-08',to:'2026-09-06',days:30,warning:''},complete:true});
assert.deepEqual(ordersSnapshotPayload,reconciliationCalls[0].body,'Kupa and Orders send byte-equivalent complete-snapshot reconciliation RPC payloads');
const ordersDirectSnapshot=await ordersReconciliation.readBankTransactionSnapshot('12-655-1','business');
assert.deepEqual(ordersDirectSnapshot,directSnapshot,'Orders can read the same durable direct-bank snapshot as Kupa');
await ordersReconciliation.acknowledgeBankTransactionMissing(77);
assert.equal(ordersReconciliationCalls.at(-1).body.p_transaction_id,77,'Orders acknowledgement RPC is callable from the transport factory and preserves the archive row id');
await ordersReconciliation.acknowledgeBankTransactionAlert(77,'returned_cheque');
assert.deepEqual(ordersReconciliationCalls.at(-1).body,{p_transaction_id:77,p_alert_kind:'returned_cheque'},'Orders uses the same per-alert acknowledgement RPC contract as Kupa');

console.log('PASS bank archive transport: collision-safe identities and >1000-row pagination are deterministic in both apps');
