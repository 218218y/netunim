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
 const transfer=new DataTransfer();for(const name of ['first.pdf','second.pdf'])transfer.items.add(new File([bytes,name],name,{type:'application/pdf'}));
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
 check([...fixture.querySelectorAll('[data-expense-command="review-source"]')].every(button=>!button.closest('label')),'source navigation created multiple labelable controls inside one field label');
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

REVIEW = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const choose=async(file)=>{await uiFeature.actions['morning-expense-files']({files:[file]});await settle()};
 const field=(name,value,type='input')=>{const input=fixture.querySelector('[data-expense-field="'+name+'"]');input.value=value;input.dispatchEvent(new Event(type,{bubbles:true}));return input};
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]').value;
 const status=name=>fixture.querySelector('[data-expense-review-field="'+name+'"]').dataset.reviewStatus;
 const beforePartial=structuredClone(recognized);
 recognized.fields.date.value=null;recognized.fields.date.status='missing';recognized.fields.documentType.value=null;recognized.fields.documentType.status='missing';
 await choose(new File(['%PDF-1.4 partial review'],'partial.pdf',{type:'application/pdf'}));
 check(value('date')===''&&value('documentType')==='','partial recognition silently kept today or default document type');
 check(status('date')==='missing'&&status('documentType')==='missing','missing core fields not marked beside inputs');
 check(document.activeElement.dataset.expenseField==='documentType','first missing field was not focused after partial recognition');
 click('save');await settle();check(posts===0,'missing core fields reached financial writer');
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'remove-file',expenseIndex:'0'}});await settle();Object.assign(recognized,beforePartial);
 await choose(new File(['%PDF-1.4 review states'],'review.pdf',{type:'application/pdf'}));
 for(const name of ['supplierId','documentType','number','date','net','vat','gross','allocationNumber']){
  check(status(name)===(name==='allocationNumber'?'not_required':'verified'),'recognized badge missing on '+name);
  const input=name==='supplierId'?fixture.querySelector('[data-expense-field="supplierQuery"]'):name==='date'?fixture.querySelector('[data-date-part="day"]'):fixture.querySelector('[data-expense-field="'+name+'"]');
  check(input.getAttribute('aria-describedby')==='expense-review-'+name,'review is not accessible on '+name);
 }
 const edited=field('number','MANUAL-0009');edited.focus();click('local-start');await settle();
 check(value('number')==='MANUAL-0009'&&status('number')==='manual'&&document.activeElement.dataset.expenseField==='number','re-recognition lost manual provenance or focus');
 field('net','1200.00');check(status('net')==='manual'&&status('vat')==='review'&&status('gross')==='review','dependent amount provenance missing');
 const beforeConfirm=confirms;confirmWait={then:resolve=>resolve(confirms===beforeConfirm+1)};click('save');await settle();check(posts===0&&confirmations.at(-1).includes('הושלם ידנית'),'final confirmation missed manual provenance: '+confirmations.at(-1));confirmWait=null;
 field('number','');check(status('number')==='missing','cleared manual field still shown as completed');
 field('number','MANUAL-0010');
 const original=structuredClone(recognized);
 for(const outcome of ['no_usable_text','unknown_supplier']){
  recognized.profile=null;recognized.outcome=outcome;for(const field of Object.values(recognized.fields)){field.value=null;field.status='missing';}
  click('local-start');await settle();
  const local=fixture.querySelector('[data-expense-local]');check(local.dataset.recognitionOutcome===outcome,'recognition result is not distinct');
  check(!local.textContent.includes('הנתונים מולאו')&&value('number')==='MANUAL-0010','empty recognition overwrote manual intake or reported success');
  check(!fixture.querySelector('[data-action="morning-expense-save"]').disabled,'manual saving blocked by no-text PDF');
 }
 Object.assign(recognized,original);ports.files.extract=async()=>{throw Error('private parser fault')};click('local-start');await settle();
 check(fixture.querySelector('[data-recognition-outcome="extraction_error"]')&&!fixture.textContent.includes('private parser fault'),'technical PDF error leaked details or lost its classification');
 field('supplierId','other-supplier','change');check(status('number')==='manual'&&status('documentType')==='review','supplier change retained old recognition confidence');
 click('review-next');check(document.activeElement&&document.activeElement!==document.body,'review navigation did not focus a field');
 for(let n=0;n<8&&document.activeElement.dataset.datePart!=='day';n++)click('review-next');
 check(document.activeElement.dataset.datePart==='day','review navigation never reached date');click('review-next');
 check(!document.activeElement.dataset.datePart,'review navigation got stuck on composite date field');
 await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'remove-file',expenseIndex:'0'}});await settle();
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 await choose(new File([png],'source.png',{type:'image/png'}));check(fixture.textContent.includes('אין זיהוי טקסט מקומי לקובצי JPG או PNG'),'image manual-entry notice missing');
 uiFeature.runtime.dispose();await settle();check(posts===0&&uploads===0,'review acceptance performed an external write');
 return {badges:true,accessible:true,noText:true,unknown:true,technicalError:true,manualPreserved:true,images:true,posts,uploads,width:innerWidth};
})()"""

POLISH = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 recognized.fields.allocationNumber.value=null;recognized.fields.allocationNumber.status='missing';
 const bytes='%PDF-1.4 unique document A';const original=new File([bytes],'original.pdf',{type:'application/pdf'});
 const choose=async files=>{await uiFeature.actions['morning-expense-files']({files});await settle()};
 const field=(name,value,type='input')=>{const input=fixture.querySelector('[data-expense-field="'+name+'"]');input.value=value;input.dispatchEvent(new Event(type,{bubbles:true}));return input};
 const badge=name=>fixture.querySelector('[data-expense-review-field="'+name+'"]');
 await choose([original,new File([bytes],'renamed-copy.pdf',{type:'application/pdf'})]);
 check(fixture.querySelectorAll('.morning-expense-queue li').length===1,'identical bytes entered work drafts twice');
 check(fixture.querySelector('[data-expense-file-notice]').textContent.includes('כבר נוסף'),'duplicate notice was lost after recognition');
 field('number','MANUAL-KEEP');await choose([original]);
 check(fixture.querySelector('[data-expense-field="number"]').value==='MANUAL-KEEP'&&fixture.querySelectorAll('.morning-expense-queue li').length===1,'duplicate selection erased manual edits');
 await choose([new File(['%PDF-1.4 unique document B'],'original.pdf',{type:'application/pdf'})]);
 check(fixture.querySelectorAll('.morning-expense-queue li').length===2,'same name and size but different bytes were rejected');
 check(!fixture.querySelector('.morning-expense-queue-details')&&fixture.querySelector('.morning-expense-queue').getBoundingClientRect().height>0,'source queue is still collapsed');
 check(!fixture.querySelector('[data-expense-local] details')&&!fixture.textContent.includes('פרטי הזיהוי המקומי ומקורות הנתונים'),'old local details disclosure remains');
 check(fixture.querySelector('[data-expense-command="local-start"]')&&fixture.querySelector('[data-expense-command="local-fill"]'),'recognition controls were removed with the disclosure');
 check(!badge('number').textContent.includes('מספר במקור')&&!badge('number').textContent.includes('הצעה'),'invoice number still carries long provenance text');
 const save=fixture.querySelector('[data-action="morning-expense-save"]'),warnings=fixture.querySelector('[data-expense-review-warnings]');
 check(save.compareDocumentPosition(warnings)&Node.DOCUMENT_POSITION_FOLLOWING,'save button still follows warnings');
 field('date','2026-10-20','change');field('documentType','305','change');
 for(const net of ['4999.99','5000.00','5000.01']){
  field('net',net);
  const expected=net==='5000.01'?'missing':'not_required';check(badge('allocationNumber').dataset.reviewStatus===expected,'wrong allocation threshold at '+net);
  check(fixture.querySelector('[data-expense-review-warnings]').textContent.includes('מספר הקצאה')===(expected==='missing'),'optional allocation produced a warning at '+net);
 }
 const number=fixture.querySelector('[data-expense-field="number"]').getBoundingClientRect();
 const date=fixture.querySelector('.morning-expense-date fieldset').getBoundingClientRect();
 const description=fixture.querySelector('[data-expense-field="description"]').getBoundingClientRect();
 const allocation=fixture.querySelector('[data-expense-field="allocationNumber"]').getBoundingClientRect();
 check(innerWidth<=800||Math.abs(number.top-date.top)<3,'number/date inputs shifted by source hints: '+JSON.stringify({number:number.top,date:date.top}));
 check(Math.abs(description.top-allocation.top)<3&&Math.abs(description.height-allocation.height)<1,'description/allocation alignment differs with a warning');
 field('vat','0.00');check(badge('allocationNumber').dataset.reviewStatus==='not_required','zero VAT still requires allocation');
 field('vat','900.00');field('documentType','330','change');check(badge('allocationNumber').dataset.reviewStatus==='not_applicable','credit shows ordinary allocation warning');
 field('documentType','305','change');field('date','2026-01-20','change');field('net','6000.00');check(badge('allocationNumber').dataset.reviewStatus==='not_required','old invoice used June threshold');
 uiFeature.runtime.dispose();await settle();check(posts===0&&uploads===0,'polish acceptance dispatched an external operation');
 return {duplicates:true,distinctBytes:true,manualPreserved:true,openQueue:true,compact:true,alignment:true,allocation:true,posts,uploads,width:innerWidth};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-local') as browser:
        for width in [1440, 390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result = browser.evaluate(SCENARIO, timeout=45)
            assert result['posts'] == 1 and result['uploads'] == 2, result
            print('PASS local invoice review, canonical fields, exact VAT, duplicate protection and OCR separation:', result, flush=True)
        for width in [1440,390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            print('PASS recognition field states and manual fallback:', browser.evaluate(REVIEW,timeout=45),flush=True)
        for width in [1440,390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            print('PASS intake polish, content dedupe and allocation thresholds:',browser.evaluate(POLISH,timeout=45),flush=True)
        result = browser.evaluate(OWNERSHIP, timeout=45)
        assert result['posts'] == 0 and result['uploads'] == 0, result
        print('PASS local extraction cancellation, account ownership, native PDF fallback and disposal:', result, flush=True)
        assert not browser.drain_serious_errors()
