"""Real Finance screen; synthetic read-only Morning transport, no live documents."""
import base64
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(v,m)=>{if(!v)throw Error(m)};
 const wait=async predicate=>{for(let i=0;i<160;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20))}throw Error('reports timeout: '+document.querySelector('.morning-report-status')?.textContent)};
 const click=(action,value)=>{const e=[...document.querySelectorAll('[data-action="'+action+'"]')].find(row=>value===undefined||row.dataset.clickArg0===value);check(e,'missing '+action);e.click()};
 morningOperationScope.captureRead=()=>()=>{};
 const uuid=i=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(i).padStart(12,'0');
 const docs=Array.from({length:51},(_,i)=>({kind:'document',id:uuid(i),number:String(100+i),type:i===0?400:305,date:'2026-07-10',documentDate:'2026-07-10',status:0,currency:'ILS',grossCents:i===0?30650500:11800,vatCents:i===0?0:1800,name:'לקוח דוח פרטי',description:'מסמך בדיקה',selfInvoice:false,businessType:1,payments:i===0?[{type:3,amountCents:14154000},{type:1,amountCents:750000},{type:2,amountCents:8270000},{type:4,amountCents:7476500}]:[]}));
 const expenses=[1,2].map(i=>({kind:'expense',id:uuid(100+i),number:String(20+i),type:305,date:'2026-07-01',documentDate:'2026-06-28',status:30,currency:'ILS',grossCents:5900,vatCents:900,deductibleVatCents:450,deductibleCents:5000,category:'עבודות חוץ',name:'ספק דוח '+ 'בדיקה'.repeat(30),description:'הוצאה לבדיקה '+ 'תיאור'.repeat(80)}));
 const calls=[];
 cloudAuth.supaFetch=async(path,options)=>{
  const body=JSON.parse(options.body);calls.push(body);check(path==='/functions/v1/morning-documents','wrong route');
  if(body.action==='document_pdf')return new Response('%PDF-1.4\nreports fixture',{headers:{'Content-Type':'application/pdf'}});
  check(body.action==='report_page','reports attempted non-read action');
  const all=body.source==='documents'?docs:expenses;
  return Response.json({ok:true,version:1,source:body.source,fromDate:body.fromDate,toDate:body.toDate,page:body.page,pageSize:50,total:all.length,pages:Math.ceil(all.length/50),environment:'sandbox',readAt:'2026-10-19T08:00:00Z',items:all.slice(body.page*50,(body.page+1)*50)});
 };
 ui.currentView='kupa';ui.kupaSubView='summary';finance.presentation.renderKupa();
 check(document.querySelector('[data-action="set-kupa-section"][data-click-arg0="summary"]').textContent==='מאזן ודוחות','tab label');
 check(document.querySelector('.kupa-hero [data-action="tax-open"]'),'calculator not in heading');
 check(document.querySelector('.forecast-note').textContent.includes('לא חישוב רווח חשבונאי'),'cashflow forecast lost');
 click('morning-report-toggle');await wait(()=>document.querySelector('#morningReportBody'));
 check(document.querySelector('[data-action="morning-report-period"][data-click-arg0="bimonth"]').getAttribute('aria-pressed')==='true','bimonth default missing');
 click('morning-report-period','year');click('morning-report-load');await wait(()=>document.querySelector('.morning-report-cards'));
 check(calls.filter(x=>x.source==='documents').length===2,'not all document pages read');
 check(document.querySelectorAll('.morning-report-table tbody tr').length===12,'year not grouped into twelve months');
 check(!document.querySelector('.morning-report-warning'),'edited status alone marked report incomplete');
 check(document.querySelector('.morning-report-notice').textContent.includes('2 הוצאות'),'edited-expense notice missing');
 click('morning-report-detail','edited-expenses');check(document.querySelectorAll('.morning-report-details tbody tr').length===2,'edited expense list not isolated');
 click('morning-report-record',uuid(101));
 check(document.querySelector('.morning-report-record-fields').textContent.includes('28.06.2026'),'source date missing');
 check(document.querySelector('.morning-report-record-fields').textContent.includes('עבודות חוץ'),'source classification missing');
 click('morning-report-record',uuid(101));click('morning-report-detail','');
 click('morning-report-type','profit');
 const totals=[...document.querySelectorAll('.morning-report-table tfoot td')].map(x=>x.textContent);
 check(totals[0].includes('5,000')&&totals[1].includes('100')&&totals[2].includes('4,900'),'incorrect profit '+totals.join('|'));
 click('morning-report-type','vat');
 const vat=[...document.querySelectorAll('.morning-report-table tfoot td')].map(x=>x.textContent);
 check(vat[0].includes('900')&&vat[1].includes('9')&&vat[2].includes('891'),'wrong deductible VAT '+vat.join('|'));
 click('morning-report-type','profit');
 click('morning-report-detail','2026-07');check(document.querySelectorAll('.morning-report-details tbody tr').length===53,'drill-down lost source documents');
 click('morning-report-pdf');await wait(()=>document.querySelector('#morningStandalonePreviewFrame')?.src.startsWith('blob:'));click('close-modal');
 let csvBlob=null;const createUrl=URL.createObjectURL,nativeClick=HTMLAnchorElement.prototype.click;
 URL.createObjectURL=blob=>{csvBlob=blob;return createUrl(blob)};HTMLAnchorElement.prototype.click=function(){};
 click('morning-report-export');const csv=await csvBlob.text();URL.createObjectURL=createUrl;HTMLAnchorElement.prototype.click=nativeClick;
 check(csv.includes('רווח / הפסד ניהולי')&&csv.includes('4900')&&csv.includes('לקוח דוח פרטי'),'CSV missing totals or source rows');
 check(csv.includes('סטטוס במורנינג')&&csv.includes('נערכה מחדש')&&csv.includes('התאמה לדיווח קודם'),'CSV lost edited-expense context');
 click('morning-report-detail','');click('morning-report-type','receipts');return {pagesRead:3,sourceDocuments:53,profitILS:4900,pdf:true,csv:true,editedExpensesIncluded:true};
})()"""

FOLLOWUP = r"""(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)};
 const wait=async predicate=>{for(let i=0;i<160;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20))}throw Error('followup timeout')};
 let release;const held=new Promise(resolve=>release=resolve),original=cloudAuth.supaFetch;let hold=true;
 cloudAuth.supaFetch=async(...args)=>{if(hold)await held;return original(...args)};
 document.querySelector('[data-action="morning-report-load"]').click();
 cloudAuth.saveSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'synthetic',expires_at:9999999999});
 check(!document.querySelector('.morning-report-cards'),'account switch left accepted data visible');
 hold=false;release();await finance.runtime.drain();check(!document.querySelector('.morning-report-cards'),'stale completion republished private report');
 cloudAuth.supaFetch=async(path,options)=>{const body=JSON.parse(options.body);if(body.source==='expenses')return Response.json({ok:false,message:'הוצאות לא זמינות לבדיקה'},{status:502});return original(path,options)};
 document.querySelector('[data-action="morning-report-load"]').click();await wait(()=>document.querySelector('.morning-report-cards'));
 check([...document.querySelectorAll('.morning-report-card strong')][2].textContent==='—','missing expenses produced a profit');
 check(document.querySelector('.morning-report-warning').textContent.includes('הוצאות לא זמינות'),'missing-source notice absent');
 cloudAuth.supaFetch=async(path,options)=>{const body=JSON.parse(options.body);if(body.source==='documents')return Response.json({ok:false,message:'מסמכים לא זמינים לבדיקה'},{status:502});return original(path,options)};
 document.querySelector('[data-action="morning-report-load"]').click();await wait(()=>document.querySelector('.morning-report-cards'));
 document.querySelector('[data-action="morning-report-type"][data-click-arg0="receipts"]').click();
 check([...document.querySelectorAll('.morning-report-table tfoot td')].slice(0,-1).every(cell=>cell.textContent==='—'),'unavailable receipts displayed as zero');
 return {accountIsolation:true,staleCompletionBlocked:true,missingExpensesNoProfit:true,missingDocumentsNoZero:true};
})()"""

if __name__ == '__main__':
    with BrowserSession(ROOT/'netunim-orders/site', 'morning-reports') as browser:
        browser.call('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1100,'deviceScaleFactor':1,'mobile':False})
        result = browser.evaluate(FLOW, timeout=45)
        output = ROOT/'.work/morning-reports'
        output.mkdir(parents=True, exist_ok=True)
        capture = browser.call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False})
        (output/'desktop.png').write_bytes(base64.b64decode(capture['result']['data']))
        layouts = []
        for width in (1440, 1280, 1024, 768, 390, 320):
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1000,'deviceScaleFactor':1,'mobile':width<500})
            layouts.append(browser.evaluate(r"""(()=>{
              const overflow=[];
              for(const group of ['month','bimonth','quarter']){
               const select=document.querySelector('[data-report-option="group"]');select.value=group;select.dispatchEvent(new Event('change',{bubbles:true}));
               for(const type of ['receipts','profit','vat']){
                document.querySelector('[data-action="morning-report-type"][data-click-arg0="'+type+'"]').click();
                document.querySelector('[data-action="morning-report-detail"][data-click-arg0="2026-07"]').click();
                document.querySelector('[data-action="morning-report-record"][data-click-arg0="aaaaaaaa-aaaa-4aaa-aaaa-000000000101"]').click();
                document.querySelectorAll('.morning-report-explanation').forEach(e=>e.open=true);
                for(const el of document.querySelectorAll('.morning-reports table,.morning-reports th,.morning-reports td,.morning-report-table-wrap,.morning-report-record-fields')){
                  const header=el.closest('thead');if(header&&getComputedStyle(header).clipPath!=='none')continue;
                  if(el.getBoundingClientRect().width>0&&el.scrollWidth>el.clientWidth+1)overflow.push({type,tag:el.tagName,cls:el.className,scroll:el.scrollWidth,width:el.clientWidth});
                }
                for(const label of document.querySelectorAll('.morning-report-period-label')){
                  const cell=label.closest('th').getBoundingClientRect(),adjacent=label.closest('th').nextElementSibling.getBoundingClientRect();
                  const range=document.createRange();range.selectNodeContents(label);
                  for(const rect of range.getClientRects()){
                    if(rect.left<cell.left-1||rect.right>cell.right+1||rect.left<adjacent.right&&rect.right>adjacent.left&&rect.top<adjacent.bottom&&rect.bottom>adjacent.top)overflow.push({type,group,periodOverlap:label.textContent});
                  }
                }
               }
              }
              document.querySelector('[data-action="morning-report-detail"][data-click-arg0=""]').click();
              const select=document.querySelector('[data-report-option="group"]');select.value='month';select.dispatchEvent(new Event('change',{bubbles:true}));
              document.querySelector('[data-action="morning-report-type"][data-click-arg0="receipts"]').click();
              return {width:innerWidth,scroll:document.documentElement.scrollWidth,overflow};
            })()"""))
            assert layouts[-1]['scroll'] <= layouts[-1]['width'] + 1 and not layouts[-1]['overflow'], layouts[-1]
        browser.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
        mobile = browser.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,tableOverflow:document.querySelector('.morning-report-table-wrap').scrollWidth>document.querySelector('.morning-report-table-wrap').clientWidth})")
        assert mobile['scroll'] <= mobile['width'] + 1 and not mobile['tableOverflow'], mobile
        capture = browser.call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False})
        (output/'mobile.png').write_bytes(base64.b64decode(capture['result']['data']))
        custom = browser.evaluate("""(()=>{document.querySelector('[data-action="morning-report-period"][data-click-arg0="custom"]').click();return {width:innerWidth,scroll:document.documentElement.scrollWidth,parts:document.querySelectorAll('#morningReportBody [data-date-part]').length}})()""")
        assert custom['scroll'] <= custom['width'] + 1 and custom['parts'] == 6, custom
        typing = browser.evaluate(r"""(()=>{
          const editor=document.getElementById('morningReport-fromDate').closest('[data-date-editor]');
          const day=editor.querySelector('[data-date-part="day"]');day.focus();day.value='2';day.dispatchEvent(new Event('input',{bubbles:true}));
          const connected=day.isConnected;day.value='31';editor.querySelector('[data-date-part="month"]').value='02';day.dispatchEvent(new Event('input',{bubbles:true}));
          let calls=0;const original=cloudAuth.supaFetch;cloudAuth.supaFetch=(...args)=>{calls++;return original(...args)};
          document.querySelector('[data-action="morning-report-load"]').click();cloudAuth.supaFetch=original;
          return {connected,calls,error:document.querySelector('.morning-report-status').textContent};
        })()""")
        assert typing['connected'] and typing['calls'] == 0 and typing['error'], typing
        browser.evaluate("document.querySelector('[data-action=\"morning-report-period\"][data-click-arg0=\"year\"]').click()")
        isolation = browser.evaluate(FOLLOWUP, timeout=35)
        assert not browser.drain_serious_errors()
        print('PASS Morning reports UI: '+json.dumps({**result,**isolation,'mobile':mobile,'layouts':layouts}), flush=True)
