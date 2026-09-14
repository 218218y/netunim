import assert from 'node:assert/strict';
import {bankChequeImageDownloadName,bankChequeImageObjectPath,bankChequeImageReferences,bankChequeImageWithinRetention,createBankChequeImageStorage,retainBankChequeImagePreviewUrl,BANK_CHEQUE_IMAGE_RETENTION_DAYS} from '../shared/bank-cheque-images.js';
import {mergeHapoalimAdditionalDetails,normalizeHapoalimTransaction} from '../netunim-kupa/bank-bridge/lib.mjs';
import {normalizeBankFeedTransaction as normalizeKupaBankFeedTransaction} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {normalizeBankFeedTransaction as normalizeOrdersBankFeedTransaction} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';

const NOW=()=>Date.parse('2026-09-14T09:00:00Z');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),UID='11111111-1111-4111-8111-111111111111';
assert.equal(BANK_CHEQUE_IMAGE_RETENTION_DAYS,60,'cheque image cloud retention is a fixed sixty-day rolling window');
assert.equal(bankChequeImageWithinRetention('2026-09-10',{now:NOW}),true);
assert.equal(bankChequeImageWithinRetention('2026-07-16',{now:NOW}),false,'sixty calendar days are bounded; older rows are not offered');
assert.equal(bankChequeImageObjectPath(UID,'2026-09-10T09:00:00.000Z',A),`${UID}/20260910_${A}.img`,'cloud object paths contain only the authenticated uid, event date and opaque key');

const refs=bankChequeImageReferences([{date:'2026-09-10T09:00:00.000Z',checkDetails:{checkItems:[{imageFrontKey:A,imageBackKey:B}]}},{date:'2026-06-01T09:00:00.000Z',checkDetails:{checkItems:[{imageFrontKey:C}]}}],{now:NOW});
assert.deepEqual(refs.map(x=>x.key).sort(),[A,B],'only recent opaque image keys are considered for cloud upload');
const reusedAcrossDates=bankChequeImageReferences([{date:'2026-08-20T09:00:00.000Z',checkDetails:{checkItems:[{imageFrontKey:A}]}},{date:'2026-08-30T09:00:00.000Z',checkDetails:{checkItems:[{imageFrontKey:A}]}}],{now:NOW});
assert.deepEqual(reusedAcrossDates.map(x=>bankChequeImageObjectPath(UID,x.eventDate,x.key)),[`${UID}/20260830_${A}.img`,`${UID}/20260820_${A}.img`],'one Hapoalim scan reused by deposit and returned-credit transactions gets a dated cloud reference for each transaction instead of becoming unreachable from the older row');

const merged=mergeHapoalimAdditionalDetails({checkItems:[{bankNumber:'52',branchNumber:'183',accountNumber:'105012322',checkNumber:'4463454',amount:830,hasDocumentReference:true,imageFrontKey:A,imageBackKey:B}],checkCount:1,checkNumbers:['4463454'],hasDocumentReference:true});
const bankTx=normalizeHapoalimTransaction({eventDate:20260910,valueDate:20260910,eventActivityTypeCode:1,eventAmount:830,serialNumber:1,referenceNumber:999,activityDescription:'הפק.שיק בסלולר',netunimAdditionalDetails:merged});
assert.equal(bankTx.checkDetails.checkItems[0].imageFrontKey,A,'opaque image keys survive Bridge transaction normalization');
assert.equal(bankTx.checkDetails.checkItems[0].imageBackKey,B,'front and back image keys remain separate');
assert.equal(normalizeKupaBankFeedTransaction(bankTx).checkDetails.checkItems[0].imageFrontKey,A,'Kupa feed preserves image keys without persisting bank URLs or bytes');
assert.equal(normalizeOrdersBankFeedTransaction(bankTx).checkDetails.checkItems[0].imageBackKey,B,'Orders feed preserves image keys without persisting bank URLs or bytes');

const uploads=[],deletes=[],bridgeReads=[];
const supaFetch=async(path,opt={})=>{
  if(path.includes('/object/list/'))return new Response(JSON.stringify([{name:`20260701_${C}.img`}]),{status:200,headers:{'Content-Type':'application/json'}});
  if(opt.method==='POST'&&path.includes('/storage/v1/object/bank-cheque-images/')){uploads.push({path,opt});return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})}
  if(opt.method==='DELETE'){deletes.push(JSON.parse(opt.body));return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})}
  if(opt.method==='GET'&&path.includes(A))return new Response(new Blob([new Uint8Array([0xff,0xd8,0xff,0xd9])],{type:'image/jpeg'}),{status:200,headers:{'Content-Type':'image/jpeg'}});
  return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
};
const storage=createBankChequeImageStorage({supaFetch,ensureSession:async()=>({user:{id:UID},access_token:'unused'}),fetchBridgeImage:async key=>{bridgeReads.push(key);return new Blob([new Uint8Array([0xff,0xd8,0xff,0xd9])],{type:'image/jpeg'})},now:NOW});
const syncResult=await storage.sync([{date:'2026-09-10T09:00:00.000Z',checkDetails:{checkItems:[{imageFrontKey:A,imageBackKey:B}]}}]);
assert.equal(syncResult.uploaded,2,'missing recent cheque sides are uploaded exactly once');
assert.deepEqual(bridgeReads.sort(),[A,B],'cloud upload reads only the missing image bytes from the local Bridge');
assert.equal(uploads.every(x=>x.opt.headers['x-upsert']==='false'),true,'cheque image objects are immutable: no UPDATE permission or overwrite is required');
assert.equal(uploads.every(x=>x.opt.body instanceof ArrayBuffer),true,'Storage upload uses a bounded binary body compatible with the official Storage upload path, not JSON/base64');
assert.deepEqual(deletes,[{prefixes:[`${UID}/20260701_${C}.img`]}],'expired owned objects are removed through Storage API, not SQL metadata deletion');
const downloaded=await storage.download('2026-09-10T09:00:00.000Z',A);
assert.equal(downloaded?.type,'image/jpeg','private Storage downloads return the image blob for the UI');
assert.equal(await storage.download('2026-06-01T09:00:00.000Z',A),null,'UI never requests images outside retention even if an old key remains in archived JSON');

assert.equal(bankChequeImageDownloadName('2026-09-10T09:00:00.000Z','חזית','image/jpeg'),'bank-cheque_20260910_front.jpg','download names preserve date, side and the actual image extension');
assert.equal(bankChequeImageDownloadName('2026-09-10','גב','image/png'),'bank-cheque_20260910_back.png');

let previewOpen=true,observerCallback=null,observerDisconnected=false,revoked=[],imageErrorHandler=null,pagehideHandler=null;
class FakeMutationObserver{
  constructor(callback){observerCallback=callback}
  observe(){}
  disconnect(){observerDisconnected=true}
}
const previewImage={
  isConnected:true,
  addEventListener(type,handler){if(type==='error')imageErrorHandler=handler},
  removeEventListener(type,handler){if(type==='error'&&imageErrorHandler===handler)imageErrorHandler=null},
};
const previewBackdrop={classList:{contains:name=>name==='open'&&previewOpen}};
const previewPage={
  addEventListener(type,handler){if(type==='pagehide')pagehideHandler=handler},
  removeEventListener(type,handler){if(type==='pagehide'&&pagehideHandler===handler)pagehideHandler=null},
};
retainBankChequeImagePreviewUrl('blob:cheque-preview',{image:previewImage,backdrop:previewBackdrop,pageTarget:previewPage,MutationObserverImpl:FakeMutationObserver,revokeObjectUrl:value=>revoked.push(value)});
assert.deepEqual(revoked,[],'preview Blob URL remains valid while the modal is open so browser save/download can still read it after image load');
observerCallback();
assert.deepEqual(revoked,[],'ordinary modal mutations do not revoke a live preview URL');
previewOpen=false;
observerCallback();
assert.deepEqual(revoked,['blob:cheque-preview'],'closing the modal revokes the preview URL exactly when it is no longer usable');
assert.equal(observerDisconnected,true,'preview lifecycle observer is disconnected after release');
assert.equal(imageErrorHandler,null,'preview cleanup removes the image error listener');
assert.equal(pagehideHandler,null,'preview cleanup removes the page lifecycle listener');
