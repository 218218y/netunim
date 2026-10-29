"""Real expense UI and file upload effects, synthetic provider; no live writes."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_expenses import FLOW

PREFIX = FLOW[:FLOW.index(' const settle=')]
PREFIX = PREFIX.replace('create:true,upload:uploadEnabled', 'create:true,upload:uploadEnabled,ocr:true,ocrRecovery:true')
PREFIX = PREFIX.replace(' const respond=async', " let ocrOperation='',ocrHash='',ocrSize=0,ocrOffline=false; const ocrBase=()=>({operationId:ocrOperation,approvalVerified:false,parsingVerified:false,fileSha256:ocrHash,fileSize:ocrSize});\n const respond=async")
PREFIX = PREFIX.replace("  throw Error('unexpected '+action);", r"""
  if(ocrOffline&&['ocr_list','ocr_status'].includes(action))throw Error('OCR offline during reload');
  if(action==='ocr_list')return {items:ocrOperation?[{...ocrBase(),state:'review_required'}]:[]};
  if(action==='ocr_prepare'){ocrOperation=body.operationId;ocrHash=body.sha256;ocrSize=body.size;return {...ocrBase(),state:'reserved'}};
  if(action==='ocr_ticket')return {...ocrBase(),state:'ticket_issued',url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded',maxFileSize:20971520,fields:{key:'synthetic',Policy:'signed'},filename:'netunim-ocr-'+ocrOperation+'.pdf',expiresAt:Date.now()+55000};
  if(action==='ocr_ack')return {...ocrBase(),state:'accepted'};
  if(action==='ocr_defer')return {...ocrBase(),state:'review_required',deferred:true};
  if(action==='ocr_status')return {...ocrBase(),state:'review_required',sourceVerified:true,draftId:id(77),item:{id:id(77),documentType:330,number:'000902727',date:'2026-10-20T00:00:00',currency:'ILS',netCents:100000,vatCents:15000,grossCents:115000,description:'OCR description',supplier:{name:'OCR supplier without canonical identity',id:'',taxId:'',verified:false},classification:expense.classification,missingFields:[],parsingVerified:false,approved:false}};
  throw Error('unexpected '+action);
""")
SCENARIO = PREFIX + r"""
 const settle=()=>uiFeature.runtime.drain();click('toggle');await settle();
 const bytes=new TextEncoder().encode('%PDF-1.4 synthetic source for browser OCR');
 const input=fixture.querySelector('input[type="file"]'),transfer=new DataTransfer();
 transfer.items.add(new File([bytes],'invoice-original.pdf',{type:'application/pdf'}));
 transfer.items.add(new File([bytes,'different'],'next.pdf',{type:'application/pdf'}));
 input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
 check(fixture.querySelector('[data-expense-command="ocr-start"]'),'OCR controls absent');
 click('ocr-start');await settle();check(uploads===1&&posts===0,'OCR did not upload once or created a final expense');
 const recoveryKey='morningExpenseOcrOperation:sandbox:'+owner,saved=localStorage.getItem(recoveryKey);
 check(saved&&JSON.parse(saved).operationId===ocrOperation,'OCR pointer missing');
 check(!saved.includes('invoice-original')&&!saved.includes(ocrHash)&&!saved.includes('000902727'),'OCR recovery retained sensitive data');
 click('ocr-start');await settle();check(uploads===1,'OCR uploaded twice');
 click('ocr-status');await settle();click('ocr-fill');await settle();
 const value=name=>fixture.querySelector('[data-expense-field="'+name+'"]').value;
 check(value('number')==='000902727'&&value('documentType')==='330','OCR number/type mapping failed');
 check(value('vat')==='150.00'&&value('net')==='1000.00'&&value('gross')==='1150.00','OCR manual VAT was recalculated');
 check(value('supplierId')==='','OCR invented supplier identity from name');
 check(value('reportingPeriod')==='2026-09','OCR changed the current reporting period');
 check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'OCR permitted separate expense creation');
 fixture.querySelector('[data-expense-command="choose-file"][data-expense-index="1"]').click();await settle();
 const edited=fixture.querySelector('[data-expense-field="number"]');edited.value='kept-edit';edited.dispatchEvent(new Event('input',{bubbles:true}));
 click('ocr-fill');await settle();check(value('number')==='kept-edit','wrong source preview overwrote the edited OCR form');
 check(fixture.textContent.includes('אינו מסמך המקור'),'wrong source preview was not explained');
 fixture.querySelector('[data-expense-command="choose-file"][data-expense-index="0"]').click();await settle();
 await uiFeature.actions['morning-expense-save']();await settle();check(posts===0,'keyboard/command bypassed OCR duplicate protection');
 const first=ocrOperation;
 ocrOffline=true;uiFeature.runtime.dispose();uiFeature=createMorningExpenseIntake(ports);fixture.innerHTML=uiFeature.markup();click('toggle');await settle();
 check(fixture.querySelector('[data-expense-ocr]').textContent.includes(first),'OCR did not recover after reopening');
 check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'OCR lookup failure reopened ordinary creation');
 check(uploads===1&&posts===0,'recovery replayed upload or created expense');
 ocrOffline=false;click('ocr-status');await settle();
 click('ocr-fill');await settle();check(value('number')==='000902727','recovered OCR could not refill suggestions');
 click('ocr-defer');await settle();check(!localStorage.getItem(recoveryKey),'explicit pending did not clear active recovery pointer');
 check(value('number')===''&&value('vat')==='','deferred OCR values leaked into the next manual invoice after reopening');
 check(fixture.querySelector('[data-expense-command="ocr-resume"]'),'deferred OCR missing from server history');
 click('ocr-resume');await settle();check(fixture.querySelector('[data-action="morning-expense-save"]').disabled,'resumed draft allowed a separate expense');
 owner=id(9);listener();check(!fixture.textContent.includes(first)&&!fixture.textContent.includes('OCR description'),'OCR leaked into another account');
 uiFeature.runtime.dispose();localStorage.removeItem(recoveryKey);
 return {uploads,posts,recovered:true,pending:true,isolated:true,width:innerWidth};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-expense-ocr') as browser:
        for width in [1440, 390]:
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<800})
            result = browser.evaluate(SCENARIO, timeout=45)
            assert result['uploads'] == 1 and result['posts'] == 0, result
            print('PASS OCR review, exact VAT, no duplicate expense, recovery and account isolation:', result, flush=True)
        assert not browser.drain_serious_errors()
