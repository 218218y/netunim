import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractInvoicePdf} from '../netunim-orders/site/assets/js/domains/finance/invoice-pdf.js';
import {invoicePageGeometry} from '../netunim-orders/site/assets/js/core/invoice-pdf-layout.js';
import {assertPdfJsCore} from '../netunim-orders/site/assets/js/domains/documents/pdfjs-core.js';
const item=(str,x,y=700)=>({str,dir:/[א-ת]/.test(str)?'rtl':'ltr',transform:[10,0,0,10,x,y],width:str.length*5,height:10,fontName:'synthetic-font',hasEOL:false});
const page=()=>({pageNumber:1,rotate:0,getViewport:()=>({width:600,height:800,transform:[1,0,0,-1,0,800]}),cleanup:()=>{}});
const file=()=>new Blob(['%PDF-1.4 synthetic'],{type:'application/pdf'});
function fixture({pages=1,error=null,held=false}={}){
  let destroyed=0,cleaned=0,opened=0,options;
  const current=page();current.cleanup=()=>cleaned++;current.getTextContent=async()=>({items:[item('חשבונית',300),item('000123',220)],styles:{'synthetic-font':{fontFamily:'sans-serif'}}});
  const engine={getDocument:value=>{options=value;opened++;return {promise:error?Promise.reject(error):held?new Promise(()=>{}):Promise.resolve({numPages:pages,getPage:async()=>current}),destroy:async()=>{destroyed++;}};}};
  return {load:async()=>engine,state:()=>({destroyed,cleaned,opened,options})};
}
test('local PDF extraction preserves source strings, font runs, positions and line evidence, then releases the worker',async()=>{
  const f=fixture(),result=await extractInvoicePdf(file(),{load:f.load});
  assert.equal(result.pages.length,1);assert.equal(result.pages[0].items[1].text,'000123');assert.equal(result.pages[0].items[1].original.y,700);
  assert.equal(result.pages[0].items[1].y,100);assert.equal(result.pages[0].items[1].fontName,'synthetic-font');
  assert.equal(f.state().destroyed,1);assert.equal(f.state().cleaned,1);
  assert.equal(f.state().options.isEvalSupported,false);assert.equal(f.state().options.enableXfa,false);assert.ok(!f.state().options.url);
});
test('fragmented Hebrew uses geometry while duplicate overprint remains preserved in original evidence',()=>{
  const fragments=[item('ת',100),item('י',105),item('נ',110),item('ו',115),item('ב',120),item('ש',125),item('ח',130),item('000123',50)];
  fragments.push({...fragments[7],transform:[10,0,0,10,50.5,700]});
  const result=invoicePageGeometry(page(),{items:fragments,styles:{}});
  assert.equal(result.items.length,9);assert.equal(result.lines[0].items.length,8);
  assert.ok(result.lines[0].key.includes('חשבונית'));assert.equal(result.items[7].text,'000123');
  assert.ok(result.lines[0].cells.every(cell=>cell.sources.every(index=>result.items[index])));
});
test('rotation is normalized to the dominant reading direction without losing original transforms',()=>{
  const raw={items:[item('000123',100),item('חשבונית',200)],styles:{}};
  const normal=invoicePageGeometry(page(),raw);
  const rotated=invoicePageGeometry({...page(),rotate:90,getViewport:()=>({width:800,height:600,transform:[0,1,1,0,0,0]})},raw);
  assert.equal(rotated.readingRotation,90);assert.equal(Math.round(rotated.items[0].x),Math.round(normal.items[0].x));
  assert.equal(Math.round(rotated.items[0].y),Math.round(normal.items[0].y));assert.deepEqual(rotated.items[0].transform,raw.items[0].transform);
});
test('invalid, encrypted and excessive PDFs fail without leaking a document or changing input bytes',async()=>{
  const f=fixture();await assert.rejects(extractInvoicePdf(new Blob(['invalid']),{load:f.load}),/type/);assert.equal(f.state().opened,0);
  const password=fixture({error:Object.assign(Error('password required'),{name:'PasswordException'})});
  await assert.rejects(extractInvoicePdf(file(),{load:password.load}),{name:'PasswordException'});assert.equal(password.state().destroyed,1);
  const excessive=fixture({pages:61});await assert.rejects(extractInvoicePdf(file(),{load:excessive.load}),/pages/);assert.equal(excessive.state().destroyed,1);
});
test('cancellation, timeouts and account replacement fence all delayed PDF completions',async()=>{
  const f=fixture({held:true}),controller=new AbortController();const pending=extractInvoicePdf(file(),{load:f.load,signal:controller.signal});
  await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.state().destroyed,1);
  const timed=fixture({held:true});await assert.rejects(extractInvoicePdf(file(),{load:timed.load,timeoutMs:5}),{name:'TimeoutError'});assert.equal(timed.state().destroyed,1);
  const stale=fixture();await assert.rejects(extractInvoicePdf(file(),{load:stale.load,check:()=>{throw Error('account replaced');}}),/account replaced/);assert.equal(stale.state().opened,0);
});
test('the shared PDF core fails closed on a mismatched pinned version or build',()=>{
  assert.throws(()=>assertPdfJsCore({version:'6.4.299',build:'different',getDocument(){},GlobalWorkerOptions:{}}),/contract/);
});

test('sixty-page extraction yields between pages and rejects excessive line density',async()=>{
  const f=fixture({pages:60});let ticks=0;
  const timer=setInterval(()=>ticks++,0);
  try{assert.equal((await extractInvoicePdf(file(),{load:f.load})).pages.length,60);}finally{clearInterval(timer);}
  assert.ok(ticks>=10,'long extraction starved other work');assert.equal(f.state().cleaned,60);assert.equal(f.state().destroyed,1);
  const dense=Array.from({length:2001},(_,n)=>item(String(n),n*8));
  assert.throws(()=>invoicePageGeometry(page(),{items:dense,styles:{}}),/layout_limit/);
});
