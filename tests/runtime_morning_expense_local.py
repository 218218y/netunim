"""Local PDF proposals in the real expense UI; only synthetic providers/files."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_ocr import PREFIX as OCR_PREFIX

PREFIX = OCR_PREFIX.replace('ocr:true,ocrRecovery:true', 'ocr:true,ocrRecovery:true,ocrFileGuard:true')
PREFIX = PREFIX.replace("  if(action==='ocr_list')", "  if(action==='ocr_lookup')return {hasOcrOperation:!!ocrOperation,...(ocrOperation?{operationId:ocrOperation}:{})};\n  if(action==='ocr_list')")
PREFIX = PREFIX.replace("  if(action==='expenses'){", "  if(action==='expenses'){if(body.number)return paged(localDuplicate?[{...expense,number:body.number,type:305,supplierTaxId:supplier.taxId}]:[]);")
PREFIX = PREFIX.replace(' const respond=async', ' let localDuplicate=false; const respond=async')
PREFIX = PREFIX.replace(' let uiFeature=createMorningExpenseIntake(ports);', r"""
 let extractionHold=null,extractions=0,signalAborted=false,recognitions=0;
 const suggestion=(value,extra={})=>({value,status:'verified',sources:[{page:1}],...extra});
 const recognized={version:1,source:'local_pdf',profile:'roya',fields:{supplier:suggestion(supplier.taxId,{status:'review'}),
  invoiceNumber:suggestion('0123456789',{rawNumber:'s0123456789',suggestedNumber:'0123456789',effectiveNumber:null}),
  documentType:suggestion(305),date:suggestion('2026-10-20'),net:suggestion(100000),vat:suggestion(16000),gross:suggestion(116000),
  allocationNumber:suggestion('123456789'),currency:suggestion('ILS')},warnings:[]};
 ports.files.extract=async(file,{signal,check})=>{extractions++;if(extractionHold)await Promise.race([extractionHold,new Promise((_,reject)=>signal.addEventListener('abort',()=>{signalAborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}))]);check();return {source:'local_pdf',pages:[],hasText:true}};
 ports.files.recognize=async()=>{recognitions++;return structuredClone(recognized)};
 let uiFeature=createMorningExpenseIntake(ports);
""")
SCENARIO = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 synthetic local source');
 const choose=async(name='invoice.pdf')=>{const input=fixture.querySelector('input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File([bytes,name],{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle()};
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]').value;
 const field=(name,value,type='input')=>{const el=fixture.querySelector('[data-expense-field="'+name+'"]');el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}));return el};
 const review=()=>check(!fixture.querySelector('[data-local-reviewed]'),'redundant source-review checkbox remains');
 await choose();check(extractions===1&&recognitions===1&&uploads===0&&posts===0,'selection caused uploads or financial effects');
 check(value('number')==='0123456789'&&value('supplierId')===supplier.id,'number zero or canonical supplier lost');
 check(value('vat')==='160.00'&&value('net')==='1000.00'&&value('gross')==='1160.00','explicit source amounts recalculated');
 check(value('allocationNumber')==='123456789'&&value('reportingPeriod')==='2026-09','allocation or reporting-period mapping lost');
 check(fixture.querySelector('[data-expense-pdf-preview]')&&!fixture.querySelector('iframe'),'PDF preview is not raster-only');
 check(fixture.textContent.includes('s0123456789')&&fixture.textContent.includes('0123456789'),'source/proposal provenance missing');
 confirmWait=Promise.resolve(false);click('save');await settle();check(posts===0,'cancelled final confirmation created an expense');confirmWait=null;
 review();field('description','checked edit');check(fixture.querySelector('[data-expense-sanity]').textContent.includes('בדיקת סבירות'),'atypical VAT has no visible plausibility warning');
 review();localDuplicate=true;click('save');await settle();check(posts===0&&fixture.textContent.includes('כפילות'),'existing invoice was not stopped before POST');localDuplicate=false;
 // An edit while extraction is in flight must survive automatic completion.
 let release;extractionHold=new Promise(resolve=>release=resolve);click('local-start');
 await new Promise(resolve=>setTimeout(resolve,20));field('number','manual-0007');release();await settle();extractionHold=null;
 check(value('number')==='manual-0007','late recognition overwrote a manual edit');click('local-fill');await settle();check(value('number')==='0123456789','explicit refill unavailable');
 // The final path remains the existing writer, confirmation, upload and receipt.
 review();click('save');await settle();check(posts===1&&uploads===0,'local path did not use the existing writer exactly once');
 check(requests.find(row=>row.action==='create').body.expense.number==='0123456789','financial payload removed leading zero');
 click('upload');await settle();linked=true;click('file-status');await settle();click('next');await settle();
 check(uploads===1&&posts===1&&!value('number'),'verified file completion did not advance cleanly');
 // Morning OCR is explicit; a deferred draft still blocks local re-entry.
 await choose('ocr-source.pdf');click('ocr-start');await settle();check(uploads===2&&posts===1,'OCR separation failed');
 click('ocr-defer');await settle();await choose('same-file-renamed.pdf');
 check(fixture.textContent.includes('קיימת פעולת OCR')&&fixture.querySelector('[data-action="morning-expense-save"]').disabled,'deferred OCR hash allowed local re-entry');
 const stored=Object.keys(localStorage).filter(key=>key.startsWith('morningExpense')).map(key=>localStorage.getItem(key)).join('');
 check(!stored.includes('s0123456789')&&!stored.includes('manual-0007')&&!stored.includes('123456789'),'invoice text leaked to localStorage');
 owner=id(9);listener();check(!fixture.textContent.includes('s0123456789'),'source proposal leaked across accounts');
 uiFeature.runtime.dispose();localStorage.removeItem('morningExpenseOcrOperation:sandbox:'+id(1));
 return {posts,uploads,local:true,canonical:true,duplicateStopped:true,width:innerWidth};
})()"""

OWNERSHIP = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 cancellable local source');
 const waitFor=async predicate=>{for(let n=0;n<200&&!predicate();n++)await new Promise(resolve=>setTimeout(resolve,10));check(predicate(),'local extraction did not enter the controlled pending state')};
 const transfer=new DataTransfer();for(const name of ['first.pdf','second.pdf'])transfer.items.add(new File([bytes],name,{type:'application/pdf'}));
 let release;extractionHold=new Promise(resolve=>release=resolve);
 await uiFeature.actions['morning-expense-files']({files:transfer.files});await waitFor(()=>extractions===1);
 fixture.querySelector('[data-expense-command="choose-file"][data-expense-index="1"]').click();
 release();await settle();check(signalAborted&&extractions===2,'switching files failed to cancel old extraction');
 check(fixture.querySelector('.morning-expense-source>b').textContent==='second.pdf','wrong source selected after cancellation: '+fixture.querySelector('.morning-expense-source>b').textContent);
 signalAborted=false;extractionHold=new Promise(resolve=>release=resolve);click('local-start');await waitFor(()=>extractions===3);
 owner=id(9);listener();release();await settle();check(signalAborted&&!fixture.textContent.includes('s0123456789'),'account switch leaked or retained local work');
 click('load');await settle();extractionHold=null;
 let pdf='%PDF-1.4\n';const offsets=[0],objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream='BT /F1 12 Tf 50 700 Td (Unknown synthetic supplier invoice 0001234567) Tj ET';objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
 objects.push(objects[2].replace('/Contents 5 0 R','/Contents 7 0 R'));
 const summaryStream='BT /F1 12 Tf 50 150 Td (1000.00) Tj 0 -20 Td (160.00) Tj 0 -20 Td (1160.00) Tj ET';
 objects.push('<< /Length '+summaryStream.length+' >>\nstream\n'+summaryStream+'\nendstream');
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=pdf.length;pdf+='xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 ports.files.extract=async(...args)=>(await import('./assets/js/domains/finance/invoice-pdf.js')).extractInvoicePdf(...args);
 ports.files.recognize=async(...args)=>(await import('./assets/js/core/invoice-recognition.js')).recognizeInvoice(...args);
 await uiFeature.actions['morning-expense-files']({files:[new File([pdf],'unknown.pdf',{type:'application/pdf'})]});await settle();
 check(fixture.querySelector('[data-expense-local]').textContent.includes('לא זוהו'),'real PDF core failed to report unknown supplier safely');
 const previewImage=fixture.querySelector('[data-expense-pdf-preview] img');check(previewImage,'native raster preview missing');await previewImage.decode();check(previewImage.naturalWidth>0,'native page image is empty');
 click('pdf-next');await settle();check(fixture.querySelector('[data-expense-pdf-preview]').textContent.includes('עמוד 2 מתוך 2'),'multi-page source navigation failed');
 check(fixture.querySelector('[data-expense-pdf-preview] img').src!==previewImage.src,'page image was not replaced');click('pdf-prev');await settle();
 check(fixture.querySelector('[data-expense-field="number"]').value===''&&posts===0&&uploads===0,'unknown native PDF guessed an invoice identity or wrote');
 // Replay exact source runs into the form and preview: actual PDF coordinates,
 // real renderer and scrolling/navigation, with a synthetic recognition result.
 const extracted=await ports.files.extract(new Blob([pdf],{type:'application/pdf'}));
 const {invoicePdfQuad}=await import('./assets/js/core/invoice-pdf-layout.js');
 const replay=structuredClone(recognized);for(const field of Object.values(replay.fields))field.sources=[];
 for(const [key,text]of [['net','1000.00'],['vat','160.00'],['gross','1160.00']]){
  const item=extracted.pages[1].items.find(item=>item.text===text);check(item,'native summary source missing');
  replay.fields[key].sources=[{page:2,quad:invoicePdfQuad(item)}];
 }
 ports.files.recognize=async()=>structuredClone(replay);click('local-start');await settle();
 check(fixture.querySelector('[data-pdf-current-field]').textContent.includes('לפני מע״מ'),'first highlighted field did not follow form order');
 check(fixture.querySelectorAll('.morning-expense-pdf-mark').length===3,'not all source amounts were highlighted');
 check(fixture.querySelector('[data-expense-pdf-preview]').textContent.includes('עמוד 2 מתוך 2'),'result navigation did not jump to summary page');
 click('pdf-match-next');await settle();check(fixture.querySelector('[data-pdf-current-field]').textContent.includes('מע״מ מהחשבונית'),'result navigation order is incorrect');
 const marker=fixture.querySelector('.morning-expense-pdf-mark.current').getBoundingClientRect();
 const view=fixture.querySelector('[data-invoice-pdf-viewport]').getBoundingClientRect();
 check(marker.top>=view.top&&marker.bottom<=view.bottom,'current highlight was not scrolled into view');
 click('pdf-zoom-in');check(fixture.querySelector('.morning-expense-pdf-page').style.width==='125%','PDF zoom did not preserve overlays');
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'remove-file',expenseIndex:'0'}});await settle();
 // Disposal aborts cancellable extraction while its tracked promise drains.
 ports.files.extract=async(file,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{signalAborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));
 ports.files.recognize=async()=>recognized;signalAborted=false;
 await uiFeature.actions['morning-expense-files']({files:[new File([bytes],'dispose.pdf',{type:'application/pdf'})]});await new Promise(resolve=>setTimeout(resolve,20));
 uiFeature.runtime.dispose();await settle();check(signalAborted&&!uiFeature.runtime.isPending(),'disposal left local extraction pending');
 return {cancelled:true,isolated:true,nativePdf:true,disposed:true,posts,uploads};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-local') as browser:
        for width in [1440, 390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result = browser.evaluate(SCENARIO, timeout=45)
            assert result['posts'] == 1 and result['uploads'] == 2, result
            print('PASS local invoice review, canonical fields, exact VAT, duplicate protection and OCR separation:', result, flush=True)
        result = browser.evaluate(OWNERSHIP, timeout=45)
        assert result['posts'] == 0 and result['uploads'] == 0, result
        print('PASS local extraction cancellation, account ownership, native PDF fallback and disposal:', result, flush=True)
        assert not browser.drain_serious_errors()
