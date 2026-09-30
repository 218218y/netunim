import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPdfFormValues,extractInteractivePdfText,LocalPdfBinaryDataFactory,textContentToLogicalText} from '../netunim-orders/document-bridge/pdf_form_index.mjs';

test('AcroForm extraction keeps logical Hebrew field values and ignores passwords',()=>{
  const values=collectPdfFormValues([
    {fieldType:'Tx',fieldName:'name',fieldValue:'ליבי מאיר'},
    {fieldType:'Tx',fieldName:'address',fieldValue:'מצליח 5 קומה 5 בני ברק'},
    {fieldType:'Tx',fieldName:'secret',fieldValue:'hidden',password:true},
    {fieldType:'Btn',fieldName:'check',fieldValue:'Yes'},
    {fieldType:'Ch',fieldName:'choice',fieldValue:['אפשרות א','אפשרות ב']},
    {fieldType:'Tx',fieldName:'duplicate',fieldValue:'ליבי מאיר'},
  ]);
  assert.deepEqual(values,['ליבי מאיר','מצליח 5 קומה 5 בני ברק','אפשרות א','אפשרות ב']);
});

test('PDF.js page-text reconstruction preserves spaces and explicit line breaks',()=>{
  const text=textContentToLogicalText({items:[
    {str:'טופס',hasEOL:false},{str:'הזמנת',hasEOL:false},{str:'מוצר',hasEOL:true},
    {str:'מספר',hasEOL:false},{str:'הזמנה',hasEOL:false},
  ]});
  assert.equal(text,'טופס הזמנת מוצר\nמספר הזמנה');
});


test('local PDF.js binary data loader resolves percent-encoded Unicode file URLs through the filesystem',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'נטונים-pdfjs-'));
  try{
    const fontDir=path.join(root,'standard_fonts');await fs.mkdir(fontDir,{recursive:true});
    const file=path.join(fontDir,'font.bin');await fs.writeFile(file,Buffer.from([1,2,3,255]));
    const factory=new LocalPdfBinaryDataFactory({standardFontDataUrl:pathToFileURL(fontDir+path.sep).href});
    const data=await factory.fetch({kind:'standardFontDataUrl',filename:'font.bin'});
    assert.deepEqual([...data],[1,2,3,255]);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});


test('interactive PDF extraction honors an already-aborted shutdown signal before touching the file',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>extractInteractivePdfText(path.join(os.tmpdir(),'does-not-need-to-exist.pdf'),{signal:controller.signal}),error=>error?.name==='AbortError'&&error?.code==='ABORT_ERR');
});
