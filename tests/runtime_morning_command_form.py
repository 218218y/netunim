"""Production mounted form validation: no official document is issued."""
import json
from browser_harness import BrowserSession,ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=LOCAL_CLOUD+r"""
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(value,message)=>{if(!value)throw Error(message)},calls=[];
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();const request=JSON.parse(options.body);calls.push(request);if(request.action==='status')return new Response(JSON.stringify({ok:true,configured:true,available:true,environment:'sandbox',operation:null}));check(request.action==='preview','form reached official issuance');throw Error('synthetic preview capture complete')};
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
 check(!calls.some(row=>['reserve','create'].includes(row.action)),'readonly form issued a document');check(await raw()===before,'form validation/preview changed Main/Shared journals');
 return {rejected,stableIdentity:true,exactReceipts:true,noIssuance:true,journalsRetained:true};
"""
with BrowserSession(ROOT/'netunim-orders/site','morning-command-form') as browser:
 result=browser.evaluate('(async()=>{'+FLOW+'})()',timeout=35);assert result['rejected']==6;assert not browser.drain_serious_errors();print('PASS Morning command form: '+json.dumps(result))
