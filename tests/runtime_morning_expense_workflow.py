"""Stable queue/scroll, visible completion, aligned fields and in-site source viewer."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expense_local import PREFIX

SCENARIO=PREFIX.replace(' let uiFeature=createMorningExpenseIntake(ports);',r"""
 const notices=[];ports.toast=text=>notices.push(text);
 let checkEntered,releaseCheck,sourceHold=null,sourceSignal=null;
 const entered=new Promise(resolve=>checkEntered=resolve),hold=new Promise(resolve=>releaseCheck=resolve);
 let pdf='%PDF-1.4\n';const offsets=[0],stream='BT /F1 12 Tf 50 700 Td (Synthetic invoice source 000123) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'];
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=pdf.length;pdf+='xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 const providerFile=new File([pdf],'source.pdf',{type:'application/pdf'}),base=ports.request;
 ports.request=async(action,body,check,options)=>{
  if(action==='capabilities')return {...await base(action,body,check),sourceRelay:true};
  if(action==='duplicate_check'){checkEntered();await hold;check();}
  if(action==='upload_source'){uploads++;linked=true;return {ok:true,version:1,environment,fileState:'file_accepted'};}
  if(action==='source_file'){sourceSignal=options.signal;if(sourceHold)await sourceHold;check();return {ok:true,version:1,environment,file:providerFile};}
  return base(action,body,check);
 };
 recognized.fields.documentType.sources=[{page:1,quad:[40,700,200,700,40,720,200,720]}];
 let uiFeature=createMorningExpenseIntake(ports);
""")+r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 fixture.style.overflowY='auto';fixture.style.height='700px';
 const files=['first.pdf','second.pdf','third.pdf'].map(name=>new File([pdf,'\n%'+name],name,{type:'application/pdf'}));
 await uiFeature.actions['morning-expense-files']({files});await settle();
 const buttons=()=>[...fixture.querySelectorAll('[data-expense-command="choose-file"]')];
 const names=()=>buttons().map(button=>button.textContent.trim()).join(',');
 const choose=async index=>{buttons()[index].click();await settle();};
 const original=names();check(original==='first.pdf,second.pdf,third.pdf','initial order changed');
 const number=fixture.querySelector('[data-expense-field="number"]');number.value='MANUAL-0001';number.dispatchEvent(new Event('input',{bubbles:true}));
 buttons()[2].scrollIntoView({block:'center'});const top=fixture.scrollTop,windowTop=scrollY;
 await choose(2);check(names()===original,'selection reordered the queue');
 check(buttons()[2].getAttribute('aria-pressed')==='true'&&buttons().filter(button=>button.getAttribute('aria-pressed')==='true').length===1,'active file is not uniquely highlighted');
 check(Math.abs(fixture.scrollTop-top)<3&&Math.abs(scrollY-windowTop)<3,'file selection jumped the page: '+top+' -> '+fixture.scrollTop);
 await choose(0);check(names()===original&&fixture.querySelector('[data-expense-field="number"]').value==='MANUAL-0001','returning to original file lost its work or ordering');
 const rect=name=>fixture.querySelector('[data-expense-field="'+name+'"]').getBoundingClientRect();
 check(Math.abs(rect('documentType').bottom-rect('pcnClassification').bottom)<2&&Math.abs(rect('documentType').bottom-rect('reportingPeriod').bottom)<2,'recognition badge misaligned the reporting row');
 const marker=fixture.querySelector('[data-expense-review-field="documentType"]');check(marker.querySelector('button[aria-label*="למקור"]')&&getComputedStyle(marker).position==='absolute','source navigation still occupies a text row');
 today='2026-11-01';click('load');await settle();check(fixture.querySelector('[data-expense-period-warning]'),'remembered old reporting period has no reminder');
 check(Math.abs(rect('documentType').bottom-rect('reportingPeriod').bottom)<2,'period warning misaligned the controls');
 fixture.querySelector('[data-action="morning-expense-save"]').scrollIntoView({block:'center'});
 const beforeSave=fixture.scrollTop,saving=uiFeature.actions['morning-expense-save']();await entered;
 const progress=fixture.querySelector('[data-expense-progress]').getBoundingClientRect(),viewport=fixture.getBoundingClientRect();
 check(progress.top>=viewport.top-2&&progress.top<viewport.bottom-100&&fixture.scrollTop<beforeSave,'approval did not reveal progress');
 releaseCheck();await saving;await settle();
 check(posts===1&&uploads===1&&names()==='second.pdf,third.pdf','completion did not advance once in original order');
 check(notices.some(text=>text.includes('נשמרה')&&text.includes('הבא'))&&notices.some(text=>text.includes('ה־PDF הבא')),'completion/recognition is not announced');
 const workspace=fixture.querySelector('.morning-expense-workspace').getBoundingClientRect();check(workspace.top>=viewport.top-2&&workspace.top<viewport.bottom-100,'next invoice was left below the viewport');
 const pageUrl=location.href;await uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'source-open',expenseId:id(8)}});await settle();
 const dialog=document.querySelector('.morning-expense-document-dialog');check(dialog?.open&&!dialog.querySelector('iframe'),'source is not shown in our safe viewer');
 const image=dialog.querySelector('[data-source-content] img');check(image,'provider PDF did not render');await image.decode();check(image.naturalWidth>0,'source page is empty');
 check(dialog.querySelector('[data-source-download]').href.startsWith('blob:')&&dialog.querySelector('[data-source-download]').download.endsWith('.pdf')&&location.href===pageUrl,'viewer navigated or lacks explicit download');
 dialog.querySelector('[data-expense-command="pdf-next"]').click();await settle();check(dialog.textContent.includes('עמוד 2 מתוך 2'),'provider PDF page navigation failed');
 dialog.querySelector('[data-source-close]').click();check(!document.querySelector('.morning-expense-document-dialog'),'source dialog was retained');
 let releaseSource;sourceHold=new Promise(resolve=>releaseSource=resolve);
 const pending=uiFeature.actions['morning-expense-command']({dataset:{expenseCommand:'source-open',expenseId:id(8)}});
 owner=id(9);listener();releaseSource();await pending;await settle();
 check(sourceSignal.aborted&&!document.querySelector('.morning-expense-document-dialog'),'source survived account change');
 uiFeature.runtime.dispose();return {stableQueue:true,noJump:true,visibleProgress:true,notices:notices.length,aligned:true,inSiteViewer:true,posts,uploads};
})()"""

if __name__=='__main__':
 with BrowserSession(ROOT/'netunim-orders/site','expense-workflow') as browser:
  for width in [1440,390]:
   browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
   print('PASS expense workflow clarity:',browser.evaluate(SCENARIO,timeout=50),flush=True)
  assert not browser.drain_serious_errors()
