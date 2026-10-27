import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseOcrReview} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-ocr.js';
const owner='aaaaaaaa-aaaa-4aaa-aaaa-000000000001';
test('OCR recovery blocks unknown dispatch, recovers an authoritatively missing reservation and never persists invoice data', async () => {
  const storage=new Map(); globalThis.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  let mode='offline',id='',uploads=0,prepares=0,advance=0;
  const summary=state=>({operationId:id,state,approvalVerified:false,parsingVerified:false});
  const review=createExpenseOcrReview({run:work=>work(),capture:()=>()=>{},capabilities:()=>({environment:'sandbox',ocr:true,ocrRecovery:true}),accountId:()=>owner,
    selected:()=>({file:new File(['%PDF-1.4 original private invoice'],'private.pdf',{type:'application/pdf'}),type:'application/pdf'}),
    files:{upload:async()=>{uploads++;}},confirmDialog:async()=>true,apply:()=>{},advance:()=>advance++,busy:()=>false,canStart:()=>true,
    request:async(action,body)=>{
      if(action==='ocr_prepare'){prepares++;id=body.operationId;if(mode==='offline')throw Error('connection lost before persistence');return summary('reserved');}
      if(action==='ocr_status'&&mode==='unknown')throw Error('source unavailable');
      if(action==='ocr_status'||action==='ocr_defer')throw Object.assign(Error('missing'),{code:'morning_ocr_operation_missing'});
      if(action==='ocr_ticket')return {...summary('ticket_issued'),filename:'server.pdf'};
      if(action==='ocr_ack')return summary('accepted');
      assert.fail(action);
    }});
  await assert.rejects(review.start(),/connection lost/); assert.equal(review.active(),true); assert.equal(uploads,0);
  mode='unknown'; await assert.rejects(review.status(),/unavailable/); await assert.rejects(review.start(),/סריקות קודמות/); assert.equal(prepares,1);
  mode='missing'; await review.status(); mode='online'; await review.start(); assert.equal(uploads,1); assert.equal(prepares,2);
  const pointer=[...storage.values()][0]; assert.equal(JSON.parse(pointer).operationId,id); assert.ok(!pointer.includes('private')&&!pointer.includes('%PDF'));
  await review.defer(); assert.equal(advance,1); assert.equal(storage.size,0); assert.equal(review.active(),false);
});
test('failure to persist the OCR recovery pointer prevents every provider request', async () => {
  globalThis.localStorage={setItem:()=>{throw Error('storage unavailable');}};
  const review=createExpenseOcrReview({run:work=>work(),capture:()=>()=>{},capabilities:()=>({environment:'sandbox',ocr:true}),accountId:()=>owner,
    selected:()=>({file:new Blob(['%PDF-1.4']),type:'application/pdf'}),files:{upload:()=>assert.fail('unexpected upload')},
    confirmDialog:async()=>true,apply:()=>{},advance:()=>{},busy:()=>false,canStart:()=>true,request:()=>assert.fail('request preceded persistence')});
  await assert.rejects(review.start(),/storage unavailable/);
});
