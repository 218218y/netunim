import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LocalPdfBinaryDataFactory} from '../netunim-orders/document-bridge/pdf_form_index.mjs';

const corpusRoot=fileURLToPath(new URL('./fixtures/pdf-corpus/',import.meta.url));
const vendorRoot=new URL('../netunim-orders/site/assets/vendor/pdfjs/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('./fixtures/pdf-corpus/manifest.json',import.meta.url),'utf8'));

function installNodePdfJsCompatibility(){
  const define=(target,key,value)=>Object.defineProperty(target,key,{configurable:true,writable:true,value});
  if(typeof Promise.try!=='function')define(Promise,'try',function(callback,...args){return new Promise(resolve=>resolve(callback(...args)))});
  if(typeof Uint8Array.prototype.toHex!=='function')define(Uint8Array.prototype,'toHex',function(){return Array.from(this,byte=>byte.toString(16).padStart(2,'0')).join('')});
  if(typeof Math.sumPrecise!=='function')define(Math,'sumPrecise',function(values){let total=0;for(const value of values)total+=Number(value)||0;return total});
  if(typeof Map.prototype.getOrInsertComputed!=='function')define(Map.prototype,'getOrInsertComputed',function(key,callback){if(this.has(key))return this.get(key);const value=callback(key);this.set(key,value);return value});
}

let pdfjsPromise=null;
async function loadPdfJs(){
  if(pdfjsPromise)return pdfjsPromise;
  installNodePdfJsCompatibility();
  pdfjsPromise=(async()=>{
    const originalWarn=console.warn,captured=[];console.warn=(...args)=>captured.push(args);
    let pdfjs;try{pdfjs=await import(new URL('legacy/build/pdf.mjs',vendorRoot))}finally{console.warn=originalWarn}
    const unexpected=captured.map(args=>args.map(String).join(' ')).filter(message=>
      !message.startsWith('Warning: Cannot load "@napi-rs/canvas" package:')&&
      message!=='Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.'&&
      message!=='Warning: Cannot polyfill `Path2D`, rendering may be broken.'
    );
    assert.deepEqual(unexpected,[],'PDF.js corpus import emitted an unexpected warning');
    assert.equal(pdfjs.version,manifest.baselinePdfjsVersion,'PDF.js corpus must run against the reviewed runtime version');
    assert.equal(pdfjs.build,manifest.baselinePdfjsBuild,'PDF.js corpus must run against the reviewed PDF.js build');
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('legacy/build/pdf.worker.min.mjs',vendorRoot).href;
    return pdfjs;
  })();
  return pdfjsPromise;
}

async function fileBytes(name){return new Uint8Array(await fs.readFile(new URL(`./fixtures/pdf-corpus/${name}`,import.meta.url)))}
async function digest(name){return crypto.createHash('sha256').update(await fileBytes(name)).digest('hex')}

async function openPdf(name,{password}={}){
  const pdfjs=await loadPdfJs();
  const task=pdfjs.getDocument({
    data:await fileBytes(name),password,
    useWorkerFetch:false,isEvalSupported:false,disableFontFace:true,
    BinaryDataFactory:LocalPdfBinaryDataFactory,
    cMapUrl:new URL('cmaps/',vendorRoot).href,cMapPacked:true,
    standardFontDataUrl:new URL('standard_fonts/',vendorRoot).href,
    wasmUrl:new URL('wasm/',vendorRoot).href,
  });
  try{return {task,document:await task.promise}}catch(error){try{await task.destroy()}catch{}throw error}
}

async function pageText(document,pageNumber){
  const page=await document.getPage(pageNumber),content=await page.getTextContent({includeMarkedContent:false,disableNormalization:false});
  return content.items.filter(item=>typeof item?.str==='string').map(item=>item.str).join(' ').replace(/\s+/g,' ').trim();
}

const byKind=kind=>manifest.cases.find(item=>item.kind===kind);

test('PDF.js regression corpus bytes are immutable',async()=>{
  assert.equal(manifest.schema,1);
  assert.equal(manifest.cases.length,6);
  for(const fixture of manifest.cases){
    assert.equal(await digest(fixture.file),fixture.sha256,`${fixture.file} changed without a reviewed corpus manifest update`);
    assert.equal((await fs.stat(new URL(`./fixtures/pdf-corpus/${fixture.file}`,import.meta.url))).size,fixture.bytes,`${fixture.file} byte count drifted`);
  }
});

test('PDF.js corpus opens ordinary, large and empty PDFs with stable page/text semantics',async()=>{
  for(const kind of ['ordinary','large','empty']){
    const fixture=byKind(kind),{task,document}=await openPdf(fixture.file);
    try{
      assert.equal(document.numPages,fixture.expect.pages,`${kind} page count`);
      if(fixture.expect.textIncludes)assert.match(await pageText(document,1),new RegExp(fixture.expect.textIncludes.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      if(fixture.expect.lastPageTextIncludes)assert.match(await pageText(document,document.numPages),new RegExp(fixture.expect.lastPageTextIncludes.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      if(fixture.expect.textEmpty)assert.equal(await pageText(document,1),'');
    }finally{await task.destroy()}
  }
});

test('PDF.js corpus preserves Hebrew AcroForm values and checkbox/select metadata',async()=>{
  const fixture=byKind('acroform'),{task,document}=await openPdf(fixture.file);
  try{
    assert.equal(document.numPages,fixture.expect.pages);
    const page=await document.getPage(1),annotations=await page.getAnnotations({intent:'display'}),fields=new Map(annotations.map(annotation=>[annotation.fieldName,annotation]));
    assert.equal(fields.get('hebrew_text')?.fieldType,'Tx');
    assert.equal(fields.get('hebrew_text')?.fieldValue,fixture.expect.hebrewValue);
    assert.equal(fields.get('approved')?.fieldType,'Btn');
    assert.equal(fields.get('approved')?.checkBox,fixture.expect.checkboxChecked);
    assert.equal(fields.get('approved')?.fieldValue,'Yes');
    assert.equal(fields.get('choice')?.fieldType,'Ch');
    assert.equal(fields.get('choice')?.combo,true);
    assert.deepEqual(fields.get('choice')?.fieldValue,[fixture.expect.choiceValue]);
    assert.ok(fields.get('choice')?.options?.some(option=>option.displayValue===fixture.expect.choiceValue));
  }finally{await task.destroy()}
});

test('PDF.js corpus rejects malformed PDFs and enforces password protection',async()=>{
  const corrupt=byKind('corrupt'),originalWarn=console.warn,captured=[];
  console.warn=(...args)=>{const message=args.map(String).join(' ');if(message==='Warning: Indexing all PDF objects')captured.push(message);else originalWarn(...args)};
  try{await assert.rejects(()=>openPdf(corrupt.file),error=>!!error)}finally{console.warn=originalWarn}
  assert.deepEqual(captured,['Warning: Indexing all PDF objects'],'corrupt fixture should exercise PDF.js recovery before rejection');
  const protectedFixture=byKind('password');
  await assert.rejects(()=>openPdf(protectedFixture.file),error=>error?.name==='PasswordException'||Number.isFinite(Number(error?.code)));
  const {task,document}=await openPdf(protectedFixture.file,{password:protectedFixture.password});
  try{
    assert.equal(document.numPages,protectedFixture.expect.pages);
    assert.match(await pageText(document,1),new RegExp(protectedFixture.expect.textIncludes.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }finally{await task.destroy()}
});
