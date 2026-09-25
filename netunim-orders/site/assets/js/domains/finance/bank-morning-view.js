import {esc} from '../../core/values.js';
import {bankMorningEligibility} from './bank-morning.js';
import {morningDocumentLabel} from '../../core/morning-document-types.js';

export function bankMorningActionCell(row,role='business'){
  if(role!=='business')return'';
  const eligibility=bankMorningEligibility(row,role),pending=String(row?.status||'').toLowerCase()==='pending',archiveId=Number(row?.archiveId),stable=Number.isSafeInteger(archiveId)&&archiveId>0,canHandle=stable&&!pending,links=Array.isArray(row?.documentLinks)?row.documentLinks:[];
  const handledTitle=pending?'ניתן לסמן כמטופל לאחר קליטה סופית בבנק':!stable?'התנועה עדיין לא קיבלה מזהה ארכיון יציב בענן':row?.handledAt?'סומן כמטופל — לחץ לביטול':'סמן כמטופל',documentTitle=!eligibility.eligible?eligibility.reason:links.length?`הפק מסמך נוסף · כבר ${links.length===1?'הופק מסמך מאומת אחד':`הופקו ${links.length} מסמכים מאומתים`} מתנועה זו`:'הפק מסמך מתנועת הבנק';
  return `<td class="bank-transaction-actions"><button type="button" class="bank-row-action handled ${row?.handledAt?'active':''}" data-action="orders-bank-handled" data-click-arg0="${esc(stable?archiveId:'')}" data-click-arg1="${row?.handledAt?'false':'true'}" ${canHandle?'':`disabled title="${esc(handledTitle)}"`} ${canHandle?`title="${esc(handledTitle)}"`:''} aria-label="${row?.handledAt?'בטל סימון מטופל':'סמן כמטופל'}">✓</button><button type="button" class="bank-row-action create-document ${links.length?'linked':''}" data-action="orders-bank-create-document" data-click-arg0="${esc(stable?archiveId:'')}" data-click-arg1="320" ${eligibility.eligible?'':`disabled`} title="${esc(documentTitle)}" aria-label="${esc(documentTitle)}">+</button></td>`;
}


export function bankMorningLinkedDocumentsMarkup(row){
  const links=Array.isArray(row?.documentLinks)?row.documentLinks:[];if(!links.length)return'';
  const shown=links.slice(0,3);return `<div class="bank-row-morning-docs" aria-label="מסמכי Morning מקושרים">${shown.map(link=>`<button type="button" class="bank-row-morning-doc" data-action="morning-open-document" data-click-arg0="${esc(link.documentId)}" title="צפה במסמך Morning ${esc(link.documentNumber||'')}"><span aria-hidden="true">▤</span><span>${esc(morningDocumentLabel(link))}</span></button>`).join('')}${links.length>shown.length?`<small>+${esc(links.length-shown.length)} מסמכים נוספים</small>`:''}</div>`;
}

export function createBankMorningDocumentActions({getBusinessRows,openDocument}){
  function findRow(transactionId){const id=Number(transactionId);return (getBusinessRows?.()||[]).find(row=>Number(row?.archiveId)===id)||null}
  function createBankDocument(transactionId,type=320){const row=findRow(transactionId),eligibility=bankMorningEligibility(row,'business');if(!row||!eligibility.eligible)return false;openDocument(row,[320,400].includes(Number(type))?Number(type):320);return true}
  return {createBankDocument};
}
