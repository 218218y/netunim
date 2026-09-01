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
const archiveRow=i=>({merge_key:`k${i}`,transaction_date:'2026-08-01T09:00:00.000Z',processed_date:'2026-08-01T09:00:00.000Z',amount:'1',currency:'ILS',description:'x',memo:'',party_name:'',party_headline:'',message_headline:'',message_detail:'',status:'completed',balance_after:null,bank_reference:String(i),bank_serial:String(i),activity_type_code:1,cheque:false,check_details:null});
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
assert.equal(pageRequests.length,2);
assert.match(pageRequests[0],/account_role=eq\.business/);
assert.match(pageRequests[0],/offset=0/);
assert.match(pageRequests[1],/offset=1000/);

let ordersMerge=null;
const orders=createOrdersTransport({supaFetch:async(path,options={})=>{if(path.includes('/rpc/merge_bank_transactions')){ordersMerge=JSON.parse(options.body);return jsonResponse([{inserted_count:4,updated_count:0,total_count:4}])}throw new Error('unexpected request '+path)}});
await orders.mergeBankTransactions('12-655-1','business',sourceRows);
assert.deepEqual(ordersMerge.p_transactions.map(x=>x.mergeKey),keys,'Kupa and Orders derive byte-identical archive identities');

console.log('PASS bank archive transport: collision-safe identities and >1000-row pagination are deterministic in both apps');
