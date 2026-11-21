"""Production mounted form validation: no official document is issued."""
import json
from browser_harness import BrowserSession,ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=LOCAL_CLOUD+r"""
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(value,message)=>{if(!value)throw Error(message)},calls=[],contacts=[];
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
 let delayedSearch,delayedResponse=Promise.withResolvers();
 cloudAuth.supaFetch=async(path,options)=>{
  const request=JSON.parse(options.body);
  if(path.endsWith('/google-contacts-oauth')){
   contacts.push(request.action);
   if(request.action==='status')return Response.json({account:'operator@example.test',grant:'test-grant'});
   if(request.action==='prepare')return Response.json({results:[],grant:'test-grant'});
   if(request.query==='delayed'){delayedSearch=options.signal;return delayedResponse.promise;}
   return Response.json({grant:'test-grant',results:[{name:'<img src=x>',email:'selected@example.test',sources:['other']}]});
  }
  options.assertRequestScope();calls.push(request);if(request.action==='status')return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'sandbox',operation:null}));check(request.action==='preview','form reached official issuance');throw Error('synthetic preview capture complete');
 };
 const actions=domainsCustomers.morningActions,click=name=>{const button=document.querySelector('[data-action="'+name+'"]');check(button,'missing '+name);button.click()};
 actions['open-morning-standalone']();await domainsCustomers.runtime.drain();
 const fill=(id,value)=>{const field=document.getElementById(id);check(field,'missing '+id);field.value=String(value)};
 const reset=()=>{for(const [id,value]of Object.entries({morningClientName:'exact client',morningClientTaxId:'123456782',morningClientEmail:'a@example.test',morningAmount:'30',morningDocumentDate:'2026-10-15',morningDescription:'exact document'}))fill(id,value);const price=document.querySelector('[data-payment-field="price"]');price.value='30';price.dispatchEvent(new Event('input',{bubbles:true}))};
 let rejected=0;
 for(const [id,value]of [['morningClientName',''],['morningClientTaxId','123456789'],['morningClientEmail','invalid'],['morningAmount','30.01'],['morningDocumentDate',''],['morningDescription','']]){
  reset();fill(id,value);const count=calls.length;click('morning-preview');await domainsCustomers.runtime.drain();check(calls.length===count,'invalid form reached provider: '+id);rejected++;
 }
 reset();click('morning-preview');await domainsCustomers.runtime.drain();const preview=calls.at(-1);check(preview.action==='preview','valid form did not reach preview');
 check(preview.document.amount===30&&preview.document.client.taxId==='123456782'&&preview.document.payment[0].price===30,'validated payload drifted');
 const payment=JSON.stringify(preview.document.payment),id=preview.operation_id;
 click('morning-preview');await domainsCustomers.runtime.drain();check(calls.at(-1).operation_id===id&&JSON.stringify(calls.at(-1).document.payment)===payment,'preview changed operation or receipts');
 const get=id=>document.getElementById(id),wait=async predicate=>{for(let i=0;i<280;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('lookup condition timed out')};
 check(contacts.length===0,'lookup contacted Google before opening');
 const beforeLookup=calls.length;
 click('morning-email-lookup');
 check(get('morningEmailQuery').value==='exact client'&&document.activeElement===get('morningEmailQuery'),'lookup did not seed and focus the query');
 await wait(()=>document.querySelector('.morning-email-result'));
 const result=document.querySelector('.morning-email-result');
 check(!result.querySelector('img')&&result.textContent.includes('<img src=x>')&&result.textContent.includes('אנשי קשר אחרים'),'contact details were not rendered as text with source');
 const lookupQuery=get('morningEmailQuery');lookupQuery.value='delayed';lookupQuery.dispatchEvent(new Event('input',{bubbles:true}));
 await wait(()=>delayedSearch);lookupQuery.value='exact client';lookupQuery.dispatchEvent(new Event('input',{bubbles:true}));
 check(delayedSearch.aborted,'typing did not cancel the previous search');
 await wait(()=>document.querySelector('.morning-email-result'));
 delayedResponse.resolve(Response.json({grant:'test-grant',results:[{email:'obsolete@example.test',sources:['contacts']}]}));
 document.querySelector('.morning-email-result').click();
 await wait(()=>get('morningEmailLookup').hidden);
 check(get('morningClientEmail').value==='selected@example.test'&&document.activeElement===get('morningClientEmail'),'choosing a result did not fill and focus the email');
 check(get('morningDescription').value==='exact document'&&calls.length===beforeLookup,'choosing an email changed other fields or reached Morning');
 click('morning-create');
 await wait(()=>get('confirmBackdrop').classList.contains('open'));
 check(get('confirmMessage').textContent.includes('selected@example.test'),'official confirmation lacks the captured email');
 get('confirmCancel').click();await domainsCustomers.runtime.drain();
 click('morning-email-lookup');uiModal.closeModal();await wait(()=>get('morningEmailLookup').hidden);
 check(!get('morningEmailQuery').value&&get('morningClientEmail').value==='selected@example.test','closing the document retained lookup data or changed the recipient');
 check(!calls.some(row=>['reserve','create'].includes(row.action)),'readonly form issued a document');check(await raw()===before,'form validation/preview changed Main/Shared journals');
 return {rejected,stableIdentity:true,exactReceipts:true,emailLookup:true,noIssuance:true,journalsRetained:true};
"""
MOBILE_LOOKUP = r"""
await domainsCustomers.morningActions['open-morning-standalone']();
await domainsCustomers.runtime.drain();
const get=id=>document.getElementById(id), toggle=get('morningEmailLookupToggle'), panel=get('morningEmailLookup'), query=get('morningEmailQuery');
toggle.click();
const fits=panel.clientWidth>200 && panel.scrollWidth<=panel.clientWidth+1 && get('morningClientEmail').clientWidth>140;
const labelled=query.labels.length===1 && document.activeElement===query;
query.value='customer@example.test';query.dispatchEvent(new Event('input',{bubbles:true}));
const gmail=new URL(panel.querySelector('[data-email-gmail]').href);
query.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
return {fits,labelled,gmail:gmail.hostname==='mail.google.com'&&decodeURIComponent(gmail.hash)==='#search/customer@example.test',
  keyboard:panel.hidden&&toggle.getAttribute('aria-expanded')==='false'&&document.activeElement===toggle};
"""
with BrowserSession(ROOT/'netunim-orders/site','morning-command-form') as browser:
 result=browser.evaluate('(async()=>{'+FLOW+'})()',timeout=35)
 assert result['rejected']==6
 browser.call('Emulation.setDeviceMetricsOverride', {'width':390, 'height':844, 'deviceScaleFactor':1, 'mobile':True})
 mobile=browser.evaluate('(async()=>{'+MOBILE_LOOKUP+'})()',timeout=15)
 assert all(mobile.values()), mobile
 assert not browser.drain_serious_errors()
 print('PASS Morning command form: '+json.dumps({**result,'mobile':mobile}))
