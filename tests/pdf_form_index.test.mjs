import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildPdfFormMatchAnchors,collectPdfFormFields,collectPdfFormValues,extractInteractivePdfText,LocalPdfBinaryDataFactory,textContentToLogicalText} from '../netunim-orders/document-bridge/pdf_form_index.mjs';

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



test('AcroForm index keeps page geometry and turns field-value hits into authoritative preview anchors',()=>{
  const fields=collectPdfFormFields([
    {id:'name',fieldType:'Tx',fieldName:'שם',fieldValue:'ליבי מאיר ליבי',rect:[100,600,300,640]},
    {id:'secret',fieldType:'Tx',fieldName:'סוד',fieldValue:'ליבי',password:true,rect:[100,500,300,540]},
  ],3);
  assert.deepEqual(fields,[{pageNumber:3,annotationIndex:0,fieldKey:'id:name',fieldName:'שם',fieldType:'Tx',rect:[100,600,300,640],values:['ליבי מאיר ליבי'],multiLine:false}]);
  const info=buildPdfFormMatchAnchors(fields,'ליבי',{matchMode:'phrase'},20);
  assert.equal(info.capped,false);
  assert.deepEqual(info.anchors.map(anchor=>[anchor.pageNumber,anchor.fieldKey,anchor.start,anchor.end,anchor.rect]),[
    [3,'id:name',0,4,[100,600,300,640]],
    [3,'id:name',10,14,[100,600,300,640]],
  ]);
  assert.equal(info.anchors[0].snippet.match,'ליבי');
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

test('PDF byte accounting includes a file even when parsing fails',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-pdf-bytes-'));
  try{
    const file=path.join(root,'broken.pdf');await fs.writeFile(file,'broken');let bytesRead=0;
    await assert.rejects(()=>extractInteractivePdfText(file,{onBytesRead:count=>{bytesRead+=count}}));
    assert.equal(bytesRead,6);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('short-lived PDF extraction worker opens the vendored Node PDF.js build and exits',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-pdf-worker-'));
  try{
    const objects=[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
      '<< /Length 0 >>\nstream\n\nendstream',
    ];
    let source='%PDF-1.4\n';const offsets=[0];
    for(const [index,body] of objects.entries()){offsets.push(Buffer.byteLength(source));source+=`${index+1} 0 obj\n${body}\nendobj\n`}
    const xref=Buffer.byteLength(source);source+='xref\n0 5\n0000000000 65535 f \n';
    for(const offset of offsets.slice(1))source+=`${String(offset).padStart(10,'0')} 00000 n \n`;
    source+=`trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${xref}\n%%EOF\n`;
    const pdf=path.join(root,'ordinary.pdf');await fs.writeFile(pdf,source);
    const sourceRuntime=fileURLToPath(new URL('../netunim-orders/document-bridge/',import.meta.url));
    const runtime=path.join(root,'runtime');await fs.mkdir(runtime);
    for(const name of ['lib.mjs','pdf_form_index.mjs','pdf-extract-worker.mjs'])await fs.copyFile(path.join(sourceRuntime,name),path.join(runtime,name));
    await fs.cp(fileURLToPath(new URL('../netunim-orders/site/assets/vendor/pdfjs/',import.meta.url)),path.join(runtime,'pdfjs'),{recursive:true});
    const worker=path.join(runtime,'pdf-extract-worker.mjs');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[worker],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
      child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);
      child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
      child.stdin.end(JSON.stringify({fullPath:pdf,includePageText:false}));
    });
    assert.equal(result.code,0,result.stderr||result.stdout);
    const response=JSON.parse(result.stdout);assert.equal(response.ok,true);assert.equal(response.result.hasForm,false);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
