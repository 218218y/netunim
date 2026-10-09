// @ts-check
/**
 * @typedef {Record<string,unknown>} FinanceState
 * @typedef {()=>undefined} PublicationAssertion
 * @typedef {{saved:boolean,row?:{revision?:number,state?:FinanceState}}} FinanceCommit
 * @typedef {{verified:boolean,state?:FinanceState|null,financeRevision?:number}} FinanceRead
 * @typedef {{revision:number|null,assertCurrent:PublicationAssertion,warning:string,at:string,code:string}} PublicationReceipt
 * @typedef {{remoteCommitted:true,displayPublished:boolean,followupConfirmed:boolean,warning:string}} PublicationResult
 */
const WARNING='נתוני האשראי נשמרו בענן. השלמת השמירה הנלווית לא אושרה. יש לבדוק ולטעון מהענן, ללא סריקה נוספת של חברות האשראי.';
/** @param {FinanceState|undefined|null} state */
function hasCreditState(state){return !!state&&typeof state==='object'&&!Array.isArray(state)&&!!state.creditSync&&typeof state.creditSync==='object'&&!Array.isArray(state.creditSync)}
/** @param {{commit:(mutator:(state:FinanceState)=>FinanceState,lease:unknown,options:{assertCurrent:PublicationAssertion})=>Promise<FinanceCommit>,publish:(state:FinanceState)=>undefined,checkpoint:(message:string)=>Promise<unknown>,read:(options:{assertCurrent:PublicationAssertion})=>Promise<FinanceRead>}} ports */
export function createCreditPublication({commit:remoteCommit,publish,checkpoint,read}){
  for(const port of [remoteCommit,publish,checkpoint,read])if(typeof port!=='function')throw new TypeError('credit_publication_ports_required');
  /** @type {PublicationReceipt|null} */ let latest=null;
  function current(){if(!latest)return null;try{latest.assertCurrent();return latest}catch(error){if(error instanceof Error&&'code' in error&&error.code==='FINANCE_OPERATION_SCOPE_CHANGED')return null;throw error}}
  function status(){const receipt=current();return {publicationWarning:receipt?.warning||'',publicationWarningAt:receipt?.at||null,publicationWarningCode:receipt?.code||''}}
  /** @param {PublicationReceipt} receipt @param {string} message @returns {Promise<PublicationResult>} */
  async function follow(receipt,message){
    receipt.assertCurrent();let confirmed=false,code='credit_followup_not_confirmed';
    try{confirmed=await checkpoint(message)===true}catch(error){receipt.assertCurrent();if(error instanceof Error&&'code' in error&&error.code==='FINANCE_OPERATION_SCOPE_CHANGED')throw error;code=error instanceof Error?error.name:'credit_followup_error'}
    receipt.assertCurrent();const warning=confirmed?'':WARNING;
    if(latest===receipt){receipt.warning=warning;receipt.at=warning?new Date().toISOString():'';receipt.code=warning?code:''}
    return {remoteCommitted:true,displayPublished:true,followupConfirmed:confirmed,warning};
  }
  /** @param {(state:FinanceState)=>FinanceState} mutator @param {string} message @param {unknown} lease @param {PublicationAssertion} assertCurrent @returns {Promise<PublicationResult>} */
  async function commit(mutator,message,lease,assertCurrent){
    assertCurrent();/** @type {FinanceState|undefined} */ let candidate;
    const result=await remoteCommit(state=>{assertCurrent();candidate=mutator(state);return candidate},lease,{assertCurrent});assertCurrent();
    if(result?.saved!==true)throw new Error('נתוני האשראי לא נשמרו בענן. הנתונים הקודמים נשמרו; יש להתחבר ולבדוק לפני ניסיון נוסף.');
    const state=result.row?.state||candidate;if(!state||!hasCreditState(state))throw new Error('credit_publication_state_required');
    const rawRevision=result.row?.revision,revision=rawRevision===undefined?null:rawRevision;
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<1))throw new Error('credit_publication_revision_invalid');
    const prior=current();
    if(prior?.revision!==null&&prior?.revision!==undefined&&revision!==null&&revision<prior.revision)return {remoteCommitted:true,displayPublished:false,followupConfirmed:false,warning:''};
    publish(state);assertCurrent();
    const receipt={revision,assertCurrent,warning:WARNING,at:new Date().toISOString(),code:'credit_followup_not_confirmed'};latest=receipt;
    return follow(receipt,message);
  }
  /** @param {PublicationAssertion} assertCurrent @returns {Promise<boolean>} */
  async function retry(assertCurrent){
    const receipt=current();if(!receipt?.warning)return false;assertCurrent();receipt.assertCurrent();
    const result=await read({assertCurrent});assertCurrent();receipt.assertCurrent();
    if(latest!==receipt)return false;
    const revision=result.financeRevision;
    if(!result.verified||!result.state||!hasCreditState(result.state)||!Number.isSafeInteger(revision)||revision===undefined||revision<1||(receipt.revision!==null&&revision<receipt.revision))throw new Error('לא ניתן לאמת את נתוני האשראי שנשמרו בענן. האזהרה נשמרה; אין צורך בסריקה נוספת.');
    publish(result.state);assertCurrent();receipt.revision=revision;
    return (await follow(receipt,'נתוני האשראי נטענו מחדש מהענן')).followupConfirmed;
  }
  return {commit,retry,status};
}
