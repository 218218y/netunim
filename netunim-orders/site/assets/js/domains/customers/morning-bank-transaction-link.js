// @ts-check
/** @typedef {import('./morning-bank-link-form.js').BankSource} BankSource */
/** @typedef {import('./morning-bank-link-form.js').BankFormSnapshot} BankFormSnapshot */
/** @param {unknown} value */
function identity(value){if(typeof value!=='number'&&typeof value!=='string')return NaN;const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:NaN}
/** @param {unknown} row */
function archiveId(row){return row!==null&&typeof row==='object'&&!Array.isArray(row)&&'archiveId' in row?identity(row.archiveId):NaN}
/** @param {unknown} row */
function hasLinks(row){return row!==null&&typeof row==='object'&&'documentLinks' in row&&Array.isArray(row.documentLinks)&&row.documentLinks.length>0}
/**
 * Owns catalog intent and the original form snapshot. Form effects and Bank
 * eligibility/prefill policy remain separate capabilities. Accepted refreshes
 * are awaited by the enclosing Morning operation lifetime.
 * @param {{
 * session:{generation:()=>number,isActive:(generation:number)=>boolean},
 * catalog:{read:()=>unknown,ensure:()=>Promise<unknown>},
 * policy:{eligible:(row:unknown)=>{eligible:boolean,reason?:string},prefill:(row:unknown)=>import('./morning-bank-link-form.js').BankPrefill},
 * form:import('./morning-bank-link-form.js').BankLinkForm,
 * presentation:{panel:()=>string,exists:()=>boolean,query:()=>string,render:(rows:readonly unknown[],query:string,id:number|null)=>number,select:(row:unknown)=>undefined,blur:()=>undefined,toast:(text:string)=>undefined,error:(error:unknown)=>undefined}
 * }} ports
 */
export function createMorningBankTransactionLinker({session,catalog,policy,form,presentation}){
  /** @type {BankSource} */ let originSource={kind:'standalone'};
  /** @type {BankFormSnapshot|null} */ let baseSnapshot=null;
  /** @type {unknown[]} */ let rows=[];
  let sequence=0;
  /** @param {BankSource|null} source */
  function reset(source){sequence++;originSource=source&&typeof source==='object'?source:{kind:'standalone'};baseSnapshot=null;rows=[]}
  /** @param {BankSource} source */
  function panelMarkup(source=form.source()){return source?.kind==='bank'?'':presentation.panel()}
  /** @returns {unknown[]} */
  function businessRows(){try{const value=catalog.read();return Array.isArray(value)?value:[]}catch{return[]}}
  function selectedTransaction(){const source=form.source(),id=identity(source?.bankTransactionId);if(source?.kind!=='bank'||!Number.isSafeInteger(id))return null;return rows.find(row=>archiveId(row)===id)||source.bankTransaction||null}
  /** @param {string} query @returns {number} */
  function render(query=''){const source=form.source();return presentation.render(rows,query,source?.kind==='bank'?Number(source.bankTransactionId):null)}
  /** @returns {Promise<boolean>} */
  async function refresh(){
    const generation=session.generation(),request=++sequence,canPublish=()=>request===sequence&&session.isActive(generation);
    if(!canPublish()||!presentation.exists())return false;
    rows=businessRows();render(presentation.query());
    try{await catalog.ensure()}catch(error){if(canPublish())presentation.error(error)}
    if(!canPublish()||!presentation.exists())return false;
    rows=businessRows();render(presentation.query());presentation.select(selectedTransaction());return true;
  }
  /** @param {unknown} transactionId @param {{blocked?:boolean,busy?:boolean}} options @returns {boolean} */
  function link(transactionId,{blocked=false,busy=false}={}){
    if(!session.isActive(session.generation())||originSource?.kind==='bank'||blocked||busy)return false;
    const id=identity(transactionId),row=rows.find(item=>archiveId(item)===id)||businessRows().find(item=>archiveId(item)===id);
    if(!row){presentation.toast('תנועת הבנק שנבחרה אינה זמינה כרגע');return false}
    const eligibility=policy.eligible(row);
    if(!eligibility.eligible){presentation.toast(eligibility.reason||'תנועת הבנק אינה מתאימה להפקת מסמך');return false}
    if(hasLinks(row)){presentation.toast('לתנועת הבנק הזו כבר מקושר מסמך Morning מאומת. כדי למנוע כפילות יש לבחור תנועה אחרת.');return false}
    let prefill;try{prefill=policy.prefill(row)}catch{presentation.toast('לא ניתן להכין את פרטי תנועת הבנק למסמך');return false}
    if(!baseSnapshot)baseSnapshot=form.capture();form.link(prefill,row,originSource,baseSnapshot);
    render('');presentation.select(row);presentation.blur();return true;
  }
  /** @param {{blocked?:boolean,busy?:boolean}} options @returns {boolean} */
  function clear({blocked=false,busy=false}={}){
    if(!session.isActive(session.generation())||originSource?.kind==='bank'||blocked||busy)return false;
    form.clear(originSource,baseSnapshot);baseSnapshot=null;render('');presentation.select(null);return true;
  }
  /** @param {string} query @returns {number|false} */
  function filter(query=''){return session.isActive(session.generation())?render(query):false}
  return {reset,panelMarkup,refresh,filter,link,clear};
}
