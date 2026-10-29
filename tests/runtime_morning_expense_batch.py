"""Background and selected batch delivery while the next invoice stays editable."""
from browser_harness import BrowserSession,ROOT
from runtime_morning_expense_local import PREFIX

SETUP=PREFIX.replace(' let uiFeature=createMorningExpenseIntake(ports);',r"""
 for(const key of Object.keys(localStorage).filter(key=>key.startsWith('morningExpenseApproved:')))localStorage.removeItem(key);
 const notices=[],rows=new Map();ports.toast=text=>notices.push(text);
 let releaseUpload,uploadEntered=false,failUpload=false,holdUpload=true;
 const uploadHold=new Promise(resolve=>releaseUpload=resolve),base=ports.request;
 const state=row=>({ok:true,version:1,environment,operationId:row.op,verified:true,state:'created',expenseId:row.item.id,item:row.item,intent:row.intent,
  sourceExpected:true,sourceMetadata:row.sourceFile,sourceReview:row.sourceReview,sourcePending:!row.linked,sourceVerified:row.linked,fileLinked:row.linked,fileState:row.linked?'file_linked':'ticket_issued'});
 ports.request=async(action,body,check,options)=>{
  check();
  if(action==='capabilities')return {...await base(action,body,check,options),backgroundQueue:true,sourceRelay:true};
  if(action==='source_pending')return {ok:true,version:1,environment,page:0,pageSize:20,items:[...rows.values()].filter(row=>!row.linked&&row.owner===owner).map(state)};
  if(action==='create'){
   check(!rows.has(body.operationId),'financial POST replayed');posts++;
   const row={owner,op:body.operationId,sourceFile:body.sourceFile,sourceReview:body.sourceReview,linked:false,
    intent:{...body.expense,supplierName:supplier.name,supplierTaxId:supplier.taxId,amount:Number(body.expense.gross),vat:Number(body.expense.vat)},
    item:{...expense,id:id(200+posts),number:body.expense.number,createdAt:'2026-10-29T10:00:00.000Z'}};
   rows.set(body.operationId,row);return state(row);
  }
  if(action==='upload_source'){
   uploads++;const row=rows.get(body.operationId);check(row,'upload lost operation binding');
   check(body.file.name==='invoice-'+Number(row.intent.number)+'.pdf','upload used the next selected file');
   if(holdUpload){uploadEntered=true;await uploadHold;check();}
   if(failUpload)return {...state(row),sourceVerified:false,sourcePending:true};
   row.linked=true;return state(row);
  }
  if(action==='operation_status'||action==='upload_status'){
   const row=rows.get(body.operationId);if(!row||row.owner!==owner)throw Object.assign(Error('missing'),{code:'morning_expense_operation_missing'});return state(row);
  }
  return base(action,body,check,options);
 };
 let pdf='%PDF-1.4\n';const offsets=[0],stream='BT /F1 12 Tf 50 700 Td (Synthetic invoice source) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1000] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 ports.files.extract=async(file,{check})=>{check();return {name:file.name}};
 ports.files.recognize=async extraction=>{const value=structuredClone(recognized),number=extraction.name.match(/invoice-(\d+)/)?.[1]||'1';
  Object.assign(value.fields.invoiceNumber,{value:number.padStart(6,'0'),rawNumber:number.padStart(6,'0'),suggestedNumber:number.padStart(6,'0')});return value;};
 let uiFeature=createMorningExpenseIntake(ports);
""")

COMMON=r"""
 const settle=()=>uiFeature.runtime.drain(),waitFor=async predicate=>{for(let n=0;n<500&&!predicate();n++)await new Promise(resolve=>setTimeout(resolve,10));check(predicate(),'background condition timed out');};
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]')?.value;
 const field=(name,text)=>{const input=fixture.querySelector('[data-expense-field="'+name+'"]');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));return input;};
 click('toggle');await settle();
 const files=Array.from({length:4},(_,n)=>new File([pdf,'\n% '+n],'invoice-'+(n+1)+'.pdf',{type:'application/pdf'}));
 await uiFeature.actions['morning-expense-files']({files});await settle();
 check(value('number')==='000001','first recognized number missing');
 await uiFeature.actions['morning-expense-save']();await waitFor(()=>uploadEntered&&value('number')==='000002');
 check(posts===1&&uploads===1,'first background submission missing');
 const input=field('description','edited while first uploads');input.focus();input.setSelectionRange(5,5);
 check(!input.disabled&&fixture.querySelector('.morning-expense-batch-dock'),'next invoice is locked or no persistent progress');
 await uiFeature.actions['morning-expense-save']();await waitFor(()=>value('number')==='000003');
 check(posts===1,'second expense ran in parallel with unfinished source');
 await uiFeature.actions['morning-expense-batch-mark']();await waitFor(()=>value('number')==='000004');
 check(posts===1&&fixture.querySelector('[data-action="morning-expense-batch-send"]'),'approval alone dispatched or batch send absent');
 await uiFeature.actions['morning-expense-batch-send']();check(posts===1,'batch dispatched before previous expense completed');
 const fourth=field('description','fourth draft stays here');fourth.focus();fourth.setSelectionRange(7,7);
 await waitFor(()=>{const image=fixture.querySelector('[data-expense-pdf-preview] img');return image?.complete&&image.naturalWidth>0;});
 if(innerWidth<800)for(let n=0;n<4;n++)await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'pdf-zoom-in'}});
 const pdfView=fixture.querySelector('[data-invoice-pdf-viewport]');pdfView.scrollTop=100;const pdfTop=pdfView.scrollTop;check(pdfTop>0,'test source did not provide a real scroll position');
 const keys=Object.keys(localStorage).filter(key=>key.startsWith('morningExpenseApproved:'));
 check(keys.length===3,'batch operations are not durable before sending');
 check(keys.every(key=>Object.keys(JSON.parse(localStorage.getItem(key))).join(',')==='version,operationId,sha256,state'),'invoice data leaked to storage');
"""

SUCCESS=SETUP+COMMON+r"""
 holdUpload=false;releaseUpload();await settle();
 check(posts===3&&uploads===3&&[...rows.values()].every(row=>row.linked),'selected background/batch records did not complete exactly once: '+JSON.stringify({posts,uploads,notices,rows:[...rows.values()].map(row=>({number:row.intent.number,linked:row.linked}))}));
 check([...rows.values()].map(row=>row.intent.number).join(',')==='000001,000002,000003','unapproved invoice sent or queue order changed');
 check([...rows.values()][1].intent.description==='edited while first uploads','reviewed second snapshot was overwritten');
 check(value('number')==='000004'&&value('description')==='fourth draft stays here','background completion lost next draft');
 const active=fixture.querySelector('[data-expense-field="description"]');check(document.activeElement===active&&active.selectionStart===7,'background work lost typing focus/caret');
 check((fixture.querySelector('[data-invoice-pdf-viewport]')?.scrollTop||0)===pdfTop,'background work moved the source viewport');
 check(!Object.keys(localStorage).some(key=>key.startsWith('morningExpenseApproved:')),'verified operations retained recovery metadata');
 // Allocation presence is enforced before approval, alongside exact totals/date.
 field('net','6000.00');field('allocationNumber','');check(fixture.querySelector('[data-expense-approval-problem]').textContent.includes('הקצאה'),'missing allocation has no clear warning');
 check(fixture.querySelector('[data-action="morning-expense-batch-mark"]').disabled&&fixture.querySelector('[data-action="morning-expense-save"]').disabled,'missing required allocation can be approved');
 field('allocationNumber','123456789');check(!fixture.querySelector('[data-action="morning-expense-batch-mark"]').disabled,'completed allocation did not enable approval');
 uiFeature.runtime.dispose();return {backgroundEditable:true,serial:true,partialBatch:true,focusRetained:true,requiredFields:true,posts,uploads};
})()"""

FAILURE=SETUP+COMMON+r"""
 failUpload=true;holdUpload=false;releaseUpload();await settle();
 check(posts===1&&uploads===1,'failure dispatched later records or retried an upload');
 check(value('number')==='000004'&&value('description')==='fourth draft stays here','failure discarded active next draft');
 check(fixture.querySelector('.morning-expense-batch-dock.attention')&&notices.some(text=>text.includes('נעצרה')),'background failure is not persistently visible');
 check(Object.keys(localStorage).filter(key=>key.startsWith('morningExpenseApproved:')).length===3,'failed/unsent operations disappeared');
 // The provider finishes late. Recovery only reads that same expense, while
 // the editable fourth draft is retained and the next writes stay paused.
 [...rows.values()][0].linked=true;failUpload=false;
 const recover=fixture.querySelector('[data-expense-command="batch-recover"]');check(recover,'failed job has no recovery action');recover.click();await settle();
 check(posts===1&&uploads===1,'recovery created a duplicate expense or attachment');
 check(value('number')==='000004'&&value('description')==='fourth draft stays here','repair lost the draft being edited');
 const resume=fixture.querySelector('[data-expense-command="batch-resume"]');check(resume,'verified recovery has no explicit resume for queued work');resume.click();await settle();
 check(posts===3&&uploads===3&&[...rows.values()].every(row=>row.linked),'remaining approved work failed to resume exactly once');
 check(value('description')==='fourth draft stays here','remaining writes overwrote the next draft');
 uiFeature.runtime.dispose();return {failureVisible:true,stopped:true,readOnlyRecovery:true,resume:true,posts,uploads};
})()"""

REFRESH=SETUP+COMMON+r"""
 const operations=Object.keys(localStorage).filter(key=>key.startsWith('morningExpenseApproved:')).map(key=>JSON.parse(localStorage.getItem(key)));
 const old=uiFeature.runtime;old.dispose();holdUpload=false;releaseUpload();await old.drain();
 uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle();
 check(posts===1&&uploads===1,'reopening automatically replayed a financial or source write');
 check(fixture.querySelector('[data-expense-batch]').textContent.includes('מעקב קודם'),'reopening hid pending background operations');
 check(fixture.querySelector('.morning-expense-batch-dock.attention'),'reopening did not visibly surface unresolved operations');
 [...rows.values()][0].linked=true;
 const first=operations.find(op=>rows.has(op.operationId));await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'batch-recover',batchOperation:first.operationId}});await settle();
 check(posts===1&&uploads===1,'refresh recovery replayed a completed operation');
 for(const op of operations.filter(op=>!rows.has(op.operationId))){await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'batch-recover',batchOperation:op.operationId}});await settle();}
 check(!Object.keys(localStorage).some(key=>key.startsWith('morningExpenseApproved:')),'server-confirmed unsent approvals cannot be cleared for re-review');
 await uiFeature.actions['morning-expense-files']({files:[files[1]]});await settle();
 await uiFeature.actions['morning-expense-save']();await settle();check(posts===2&&uploads===2,'freshly re-reviewed unsent invoice failed or replayed an old creation');
 uiFeature.runtime.dispose();return {refreshRecovery:true,noAutomaticReplay:true,unsentReReview:true,posts,uploads};
})()"""

ACCOUNT=SETUP+COMMON+r"""
 owner=id(9);listener();holdUpload=false;releaseUpload();await settle();click('load');await settle();
 check(posts===1&&uploads===1,'account change dispatched a queued expense');
 check(!fixture.textContent.includes('invoice-1.pdf')&&!fixture.textContent.includes('fourth draft stays here'),'background job or draft leaked across accounts');
 check(Object.keys(localStorage).filter(key=>key.startsWith('morningExpenseApproved:')).length===3,'account change discarded original recovery metadata');
 uiFeature.runtime.dispose();return {accountIsolation:true,oldQueueStopped:true,posts,uploads};
})()"""

ALL=SETUP+r"""
 const settle=()=>uiFeature.runtime.drain(),waitFor=async number=>{for(let n=0;n<500&&fixture.querySelector('[data-expense-field="number"]').value!==number;n++)await new Promise(resolve=>setTimeout(resolve,10));check(fixture.querySelector('[data-expense-field="number"]').value===number,'next approval was not recognized');};
 click('toggle');await settle();
 await uiFeature.actions['morning-expense-files']({files:Array.from({length:3},(_,n)=>new File([pdf,'\n% '+n],'invoice-'+(n+1)+'.pdf',{type:'application/pdf'}))});await settle();
 for(let n=1;n<=3;n++){await waitFor(String(n).padStart(6,'0'));await uiFeature.actions['morning-expense-batch-mark']();}
 check(posts===0&&uploads===0,'approving all files dispatched a write');
 await uiFeature.actions['morning-expense-batch-send']();holdUpload=false;releaseUpload();await settle();
 check(posts===3&&uploads===3&&[...rows.values()].every(row=>row.linked),'all-approved batch did not complete exactly once');
 check(!fixture.querySelector('.morning-expense-queue li')&&!Object.keys(localStorage).some(key=>key.startsWith('morningExpenseApproved:')),'completed batch retained work or metadata');
 uiFeature.runtime.dispose();return {allApproved:true,posts,uploads};
})()"""

if __name__=='__main__':
 with BrowserSession(ROOT/'netunim-orders/site','expense-approved-batch') as browser:
  for width in [1440,390]:
   browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
   print('PASS editable background and partial approved batch:',browser.evaluate(SUCCESS,timeout=60),flush=True)
   print('PASS background failure, durable tracking and exact recovery:',browser.evaluate(FAILURE,timeout=60),flush=True)
  print('PASS refresh and existing-operation recovery:',browser.evaluate(REFRESH,timeout=60),flush=True)
  print('PASS account change stops the original queue:',browser.evaluate(ACCOUNT,timeout=60),flush=True)
  print('PASS complete approved batch:',browser.evaluate(ALL,timeout=60),flush=True)
  assert not browser.drain_serious_errors()
