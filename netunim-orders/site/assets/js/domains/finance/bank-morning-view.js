import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {bankMorningEligibility} from './bank-morning.js';

export function bankMorningActionCell(row,role='business'){
  if(role!=='business')return'';
  const eligibility=bankMorningEligibility(row,role),pending=String(row?.status||'').toLowerCase()==='pending',archiveId=Number(row?.archiveId),stable=Number.isSafeInteger(archiveId)&&archiveId>0,canHandle=stable&&!pending,links=Array.isArray(row?.documentLinks)?row.documentLinks:[];
  const handledTitle=pending?'ניתן לסמן כמטופל לאחר קליטה סופית בבנק':!stable?'התנועה עדיין לא קיבלה מזהה ארכיון יציב בענן':row?.handledAt?'סומן כמטופל — לחץ לביטול':'סמן כמטופל',documentTitle=!eligibility.eligible?eligibility.reason:links.length?`הפק מסמך נוסף · כבר ${links.length===1?'הופק מסמך מאומת אחד':`הופקו ${links.length} מסמכים מאומתים`} מתנועה זו`:'הפק מסמך מתנועת הבנק';
  return `<td class="bank-transaction-actions"><button type="button" class="bank-row-action handled ${row?.handledAt?'active':''}" data-action="orders-bank-handled" data-click-arg0="${esc(stable?archiveId:'')}" data-click-arg1="${row?.handledAt?'false':'true'}" ${canHandle?'':`disabled title="${esc(handledTitle)}"`} ${canHandle?`title="${esc(handledTitle)}"`:''} aria-label="${row?.handledAt?'בטל סימון מטופל':'סמן כמטופל'}">✓</button><button type="button" class="bank-row-action create-document ${links.length?'linked':''}" data-action="orders-bank-document-choice" data-click-arg0="${esc(stable?archiveId:'')}" ${eligibility.eligible?'':`disabled`} title="${esc(documentTitle)}" aria-label="${esc(documentTitle)}">+</button></td>`;
}

export function bankMorningChoiceMarkup(row){
  const eligibility=bankMorningEligibility(row,'business');if(!eligibility.eligible)return null;
  const links=Array.isArray(row?.documentLinks)?row.documentLinks:[],existing=links.length?`<div class="bank-morning-existing-docs"><b>${links.length===1?'כבר הופק מסמך מאומת מתנועה זו':'כבר הופקו מסמכים מאומתים מתנועה זו'}</b><small>אפשר להפיק מסמך נוסף רק אם מדובר בתקבול נוסף אמיתי. הקישור הקיים נשמר ואינו נדרס.</small>${links.slice(0,6).map(link=>`<div class="bank-morning-existing-doc"><span>${esc(Number(link.documentType)===320?'חשבונית מס / קבלה':'קבלה')} ${esc(link.documentNumber||'')} · ${money(Number(link.documentAmount)||0)}</span><button type="button" class="btn small" data-action="morning-open-document" data-click-arg0="${esc(link.documentId)}">צפה</button></div>`).join('')}${links.length>6?`<small>ועוד ${esc(links.length-6)} מסמכים מקושרים</small>`:''}</div>`:'';
  return {eligibility,body:`<div class="bank-morning-choice"><h4>${esc(row?.partyName||row?.partyHeadline||row?.description||'תנועת זכות')}</h4><p>סכום התנועה: <b>${money(Number(row?.amount)||0)}</b></p>${existing}${eligibility.aggregate?'<div class="morning-source-warning">התנועה נראית כריכוז תקבולים. ודא שהמסמך והחוב שתבחר מייצגים את התקבול הנכון.</div>':''}<div class="bank-morning-choice-actions"><button class="btn primary" data-action="orders-bank-create-document" data-click-arg0="${esc(row.archiveId)}" data-click-arg1="320">חשבונית מס / קבלה</button><button class="btn" data-action="orders-bank-create-document" data-click-arg0="${esc(row.archiveId)}" data-click-arg1="400">קבלה</button></div></div>`};
}

export function createBankMorningDocumentActions({getBusinessRows,ensureArchive,modal,openDocument}){
  function findRow(transactionId){const id=Number(transactionId);return (getBusinessRows?.()||[]).find(row=>Number(row?.archiveId)===id)||null}
  async function openBankDocumentChoice(transactionId){
    let row=findRow(transactionId);
    if(!row&&ensureArchive){await ensureArchive();row=findRow(transactionId)}
    const choice=row?bankMorningChoiceMarkup(row):null;if(!choice)return false;
    modal('הפקת מסמך מתנועת בנק',choice.body,'<button class="btn" data-action="close-modal">ביטול</button>');return true;
  }
  function createBankDocument(transactionId,type){const row=findRow(transactionId),eligibility=bankMorningEligibility(row,'business');if(!row||!eligibility.eligible)return false;openDocument(row,Number(type));return true}
  return {openBankDocumentChoice,createBankDocument};
}
