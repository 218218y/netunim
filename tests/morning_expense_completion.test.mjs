import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completeExpenseSource} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-completion.js';
import {uploadExpenseFile,validateExpenseFile} from '../netunim-orders/site/assets/js/platform/morning-expense-files.js';
function fixture(extra={}){
 const calls=[],state={verified:true,sourceExpected:true,fileState:'not_started'},file={file:new Blob(['source']),type:'application/pdf'};
 let attempted=false,uploads=0,reads=0,active=true;
 const options={selected:file,result:state,attempted:false,uploadEnabled:true,delays:[0,0,0],
 check:()=>{if(!active)throw Error('old account');},progress:()=>{},prepare:async()=>({sourceFile:{sha256:'a'.repeat(64)}}),
 markAttempted:()=>{attempted=true;},accept:value=>Object.assign(state,value),
 upload:async()=>{uploads++;return {accepted:false};},request:async(action)=>{
 calls.push(action);if(action==='upload_prepare')return {fileGeneration:'generation'};
 if(action==='upload_ticket')return {fileGeneration:'generation'};
 if(action==='upload_status'){reads++;return {sourceVerified:reads>=2,fileLinked:reads>=2,fileState:reads>=2?'file_linked':'ticket_issued'};}
 throw Error('unexpected '+action);
 },...extra};
 return {options,state,calls,uploads:()=>uploads,reads:()=>reads,attempted:()=>attempted,close:()=>{active=false;}};
}
test('opaque upload is unconfirmed; only delayed canonical byte verification completes it',async()=>{
 const f=fixture();assert.equal(await completeExpenseSource(f.options),true);
 assert.equal(f.uploads(),1);assert.equal(f.reads(),2);assert.equal(f.attempted(),true);
 assert.ok(!f.calls.includes('upload_ack'));assert.equal(f.state.sourceVerified,true);
});
test('lost upload response still reconciles without reupload; pending resumes with reads only',async()=>{
 const f=fixture({upload:async()=>{throw TypeError('Failed to fetch');}});
 assert.equal(await completeExpenseSource(f.options),true);assert.equal(f.calls.filter(a=>a==='upload_ticket').length,1);
 const pending=fixture({attempted:true,result:{verified:true,sourceExpected:true,fileState:'ticket_issued'}});
 assert.equal(await completeExpenseSource(pending.options),true);assert.equal(pending.uploads(),0);assert.ok(!pending.calls.includes('upload_ticket'));
});
test('visible file presence alone never completes a source; mismatch stops immediately',async()=>{
 const f=fixture({attempted:true,request:async()=>({fileLinked:true,sourceVerified:false})});
 assert.equal(await completeExpenseSource(f.options),false);assert.equal(f.state.sourceVerified,false);
 const bad=fixture({attempted:true,request:async()=>({fileLinked:true,sourceVerified:false,sourceCheck:'mismatch'})});
 await assert.rejects(completeExpenseSource(bad.options),/אינו תואם/);assert.equal(bad.uploads(),0);
});
test('preparation failure sends no form; account change stops later polling and completion',async()=>{
 const f=fixture({prepare:async()=>{throw Error('wrong source');}});
 await assert.rejects(completeExpenseSource(f.options),/wrong source/);assert.equal(f.uploads(),0);assert.equal(f.calls.length,0);
 const stale=fixture({attempted:true,delays:[500],sleep:async()=>stale.close()});
 await assert.rejects(completeExpenseSource(stale.options),/old account/);assert.equal(stale.reads(),0);
});
test('an unverified financial operation never uploads; manual expense needs no artificial file step',async()=>{
 const f=fixture({result:{verified:false}});assert.equal(await completeExpenseSource(f.options),false);assert.equal(f.uploads(),0);
 const manual=fixture({selected:null,result:{verified:true,sourceExpected:false}});assert.equal(await completeExpenseSource(manual.options),true);assert.equal(manual.calls.length,0);
});
test('opaque browser form response is not acknowledged as HTTP 204 or source success',async()=>{
 const file=await validateExpenseFile(new File(['%PDF-1.4'], 'synthetic.pdf',{type:'application/pdf'}));
 let count=0;
 const result=await uploadExpenseFile({url:'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded',fields:{key:'synthetic'},expiresAt:Date.now()+50000,maxFileSize:100},file,()=>{},
 {fetch:async(_,init)=>{count++;assert.equal(init.mode,'no-cors');assert.equal(init.redirect,'follow');assert.equal(init.credentials,'omit');assert.equal([...init.body.keys()].at(-1),'file');return {type:'opaque',status:0};}});
 assert.deepEqual(result,{accepted:false,fileLinked:false});assert.equal(count,1);
 for(const fields of [{success_action_redirect:'https://attacker.invalid'},{redirect:'https://attacker.invalid'},{success_action_status:'201'}])
   await assert.rejects(uploadExpenseFile({url:'https://s3.eu-west-1.amazonaws.com/file-upload-service-uploaded',fields,expiresAt:Date.now()+50000,maxFileSize:100},file,()=>{},{fetch:()=>assert.fail('redirect policy was sent')}));
});
