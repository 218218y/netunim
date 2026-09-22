import {bankMorningEligibility,bankMorningPrefill} from '../finance/bank-morning.js';
import {morningBankTransactionPickerMarkup,renderMorningBankTransactionPicker,syncMorningBankTransactionSelection} from './morning-bank-transaction-picker.js';

const DEFAULT_TYPE=320;
function clean(value,max=250){return String(value??'').trim().slice(0,max)}

export function createMorningBankTransactionLinker({toast,currentField,getActiveSource,setActiveSource,getGeneration,isActive,getBusinessBankTransactions,ensureBusinessBankTransactions,readPaymentRows,replaceMorningPayments,selectedType,syncDocumentType,syncPaymentType,syncPaymentTotal,setDateValue}){
  let originSource={kind:'standalone'},baseSnapshot=null,rows=[];
  function reset(source){originSource=source&&typeof source==='object'?source:{kind:'standalone'};baseSnapshot=null;rows=[]}
  function panelMarkup(source=getActiveSource()){return source?.kind==='bank'?'':morningBankTransactionPickerMarkup({loading:true})}
  function businessRows(){try{const value=getBusinessBankTransactions?.();return Array.isArray(value)?value:[]}catch{return[]}}
  function selectedTransaction(){const source=getActiveSource(),id=Number(source?.bankTransactionId);if(source?.kind!=='bank'||!Number.isSafeInteger(id)||id<=0)return null;return rows.find(row=>Number(row?.archiveId)===id)||source.bankTransaction||null}
  function render(query=''){const source=getActiveSource();return renderMorningBankTransactionPicker({rows,query,activeTransactionId:source?.kind==='bank'?Number(source.bankTransactionId):null})}
  async function refresh(){const generation=getGeneration();if(!currentField('morningBankTransactionRows'))return;rows=businessRows();render(currentField('morningBankTransactionSearch')?.value||'');try{await ensureBusinessBankTransactions?.()}catch(error){console.error('Morning bank transaction picker archive refresh failed',error)}if(!isActive(generation)||!currentField('morningBankTransactionRows'))return;rows=businessRows();render(currentField('morningBankTransactionSearch')?.value||'');syncMorningBankTransactionSelection({transaction:selectedTransaction()})}
  function fieldValue(id){return currentField(id)?.value??''}
  function setFieldValue(id,value){const field=currentField(id);if(field)field.value=String(value??'')}
  function setDocumentDate(value){const field=currentField('morningDocumentDate');if(field)setDateValue(field.closest?.('[data-date-editor]')||field,String(value||''),false)}
  function setDocumentType(type){const radio=document.querySelector(`input[name="morningDocumentType"][value="${Number(type)}"]`);if(radio)radio.checked=true}
  function restrictType(linked){const invoice=document.querySelector('input[name="morningDocumentType"][value="305"]');if(invoice){invoice.disabled=!!linked;invoice.closest('.morning-type-option')?.classList.toggle('disabled',!!linked)}if(linked&&selectedType()===305)setDocumentType(DEFAULT_TYPE)}
  function combineDescription(base,bank){const left=clean(base,250),right=clean(bank,250);if(!left)return right;if(!right||left.toLocaleLowerCase('he').includes(right.toLocaleLowerCase('he')))return left;return clean(`${left} · ${right}`,250)}
  function capture(){return {type:selectedType(),clientName:fieldValue('morningClientName'),amount:fieldValue('morningAmount'),date:fieldValue('morningDocumentDate'),description:fieldValue('morningDescription'),payments:readPaymentRows({strict:false})}}
  function restore(snapshot){if(!snapshot)return;setDocumentType(snapshot.type||DEFAULT_TYPE);setFieldValue('morningClientName',snapshot.clientName);setFieldValue('morningAmount',snapshot.amount);setDocumentDate(snapshot.date);setFieldValue('morningDescription',snapshot.description);replaceMorningPayments(snapshot.payments||[]);syncDocumentType();syncPaymentType();syncPaymentTotal()}
  function link(transactionId,{blocked=false,busy=false}={}){
    if(originSource?.kind==='bank'||blocked||busy)return false;const id=Number(transactionId),row=rows.find(item=>Number(item?.archiveId)===id)||businessRows().find(item=>Number(item?.archiveId)===id);if(!row){toast('תנועת הבנק שנבחרה אינה זמינה כרגע');return false}
    const eligibility=bankMorningEligibility(row,'business');if(!eligibility.eligible){toast(eligibility.reason||'תנועת הבנק אינה מתאימה להפקת מסמך');return false}if(Array.isArray(row.documentLinks)&&row.documentLinks.length){toast('לתנועת הבנק הזו כבר מקושר מסמך Morning מאומת. כדי למנוע כפילות יש לבחור תנועה אחרת.');return false}
    let prefill;try{prefill=bankMorningPrefill(row)}catch{toast('לא ניתן להכין את פרטי תנועת הבנק למסמך');return false}
    if(!baseSnapshot)baseSnapshot=capture();setActiveSource({...prefill.source,kind:'bank',bankTransaction:row,linkedFrom:originSource.kind});restrictType(true);if(originSource.kind==='standalone'&&!clean(baseSnapshot.clientName,160))setFieldValue('morningClientName',prefill.customerName||'');setDocumentDate(prefill.date);setFieldValue('morningDescription',combineDescription(baseSnapshot.description,prefill.description));replaceMorningPayments(Array.isArray(prefill.payment)?prefill.payment:[prefill.payment]);syncDocumentType();syncPaymentType();syncPaymentTotal();render('');syncMorningBankTransactionSelection({transaction:row});currentField('morningBankTransactionSearch')?.blur();return true;
  }
  function clear({blocked=false,busy=false}={}){if(originSource?.kind==='bank'||blocked||busy)return false;setActiveSource(originSource);restrictType(false);restore(baseSnapshot);baseSnapshot=null;render('');syncMorningBankTransactionSelection({transaction:null});return true}
  return {reset,panelMarkup,refresh,filter:render,link,clear};
}
