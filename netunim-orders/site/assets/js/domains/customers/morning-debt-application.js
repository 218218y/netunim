// @ts-check
/** @typedef {{amount:number,paymentApplied:number,invoiceApplied:number,paymentComplete:boolean,invoiceComplete:boolean}} FinancialSnapshot */
/** @typedef {{
 * operationId:string,debtId:string,type:number,amount:number,applyPayment:boolean,applyInvoice:boolean,
 * financialSnapshot?:FinancialSnapshot,
 * resolution?:{financialSnapshot:FinancialSnapshot,applyPayment:boolean,applyInvoice:boolean,confirmedAt:string}
 * }} ApplicationContext */
/** @typedef {{operationId?:string|undefined,documentId?:string|undefined,documentNumber?:string|number|undefined,type?:number|undefined,amount?:number|undefined,verifiedAt?:string|undefined}} VerifiedDocument */
/** @typedef {{changed:boolean,reason?:string,persisted?:boolean}} ApplicationResult */
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {{immediate?:boolean,assertCurrent?:MorningAssertion}} ApplicationOptions */
/** @typedef {Required<Pick<ApplicationContext,'debtId'|'applyPayment'|'applyInvoice'>> & VerifiedDocument} DebtApplication */
/** @typedef {{apply:(context:ApplicationContext|null,args?:VerifiedDocument,options?:ApplicationOptions)=>Promise<ApplicationResult>}} ApplicationCapability */

/**
 * Verified provider evidence and durable recovery are independent grants. Local
 * allocation requires a current cloud refresh, current debt snapshot and an
 * explicit decision when financial state has changed. The lifetime owns the
 * accepted application flight; this workflow has no DOM or persistence I/O.
 * @param {{
 * lifetime:Pick<ReturnType<import('./morning-lifetime.js').createMorningLifetime>,'capture'|'join'>,
 * recovery:{read:()=>ApplicationContext|null},
 * debts:{read:(id:string)=>unknown,refresh:()=>Promise<unknown>,isBlocked:()=>boolean,apply:(command:DebtApplication)=>ApplicationResult},
 * policy:{
 *   matches:(context:ApplicationContext,verified:VerifiedDocument)=>boolean,
 *   snapshot:(debt:unknown,operationId:string)=>FinancialSnapshot|null,
 *   changes:(before:FinancialSnapshot|undefined,current:FinancialSnapshot)=>{changed:boolean}
 * },
 * feedback:{toast:(text:string)=>void,status:(kind:string,text:string)=>void,decide:(context:ApplicationContext,current:FinancialSnapshot)=>void}
 * }} ports
 * @returns {ApplicationCapability}
 */
export function createMorningDebtApplication({lifetime,recovery,debts,policy,feedback}){
  /** @param {ApplicationContext|null} context @param {VerifiedDocument} args @param {ApplicationOptions} options */
  function apply(context,args={},options={}){
    const assertCurrent=options.assertCurrent||lifetime.capture();
    return lifetime.join('application',assertCurrent,()=>applyVerifiedContextOnce(context,args,{...options,assertCurrent}));
  }
  /** @param {ApplicationContext|null} context @param {VerifiedDocument} args @param {ApplicationOptions} options @returns {Promise<ApplicationResult>} */
  async function applyVerifiedContextOnce(context,{operationId,documentId,documentNumber,type,amount,verifiedAt}={}, {immediate=false,assertCurrent=lifetime.capture()}={}){
    assertCurrent();
    if(!context||!operationId||context.operationId!==operationId)return {changed:false,reason:'unbound-operation'};
    if(!policy.matches(context,{operationId,type,amount})){feedback.toast('המסמך אומת ב-Morning, אך פרטי האימות אינם תואמים לנקודת ההתאוששות המקומית. החוב לא עודכן אוטומטית.');return {changed:false,reason:'verification-mismatch'}}
    if(!context.debtId)return {changed:false,reason:'standalone'};
    if(!immediate){
      feedback.status('loading','ממתין להשלמת רענון החוב מהענן לפני זקיפה…');
      const refreshed=await debts.refresh();assertCurrent();
      if(refreshed!==true){feedback.status('warning','רענון החוב מהענן לא הושלם. לא בוצעה זקיפה; נקודת ההתאוששות נשארת נעולה.');return {changed:false,reason:'cloud-refresh-pending'}}
    }
    assertCurrent();lifetime.capture()();
    if(debts.isBlocked())return {changed:false,reason:'write-blocked'};
    const stored=recovery.read();if(stored?.operationId!==operationId)return {changed:false,reason:'recovery-changed'};context=stored;
    const debt=debts.read(context.debtId),current=policy.snapshot(debt,operationId);
    if(!current){feedback.toast('המסמך אומת, אך החוב חסר. נקודת ההתאוששות נשמרה עד לשחזור החוב.');return {changed:false,reason:'missing-debt'}}
    const resolution=context.resolution,reviewed=resolution&&!policy.changes(resolution.financialSnapshot,current).changed;
    let selected=context;
    if(resolution||policy.changes(context.financialSnapshot,current).changed){
      if(!reviewed||!resolution.confirmedAt){feedback.decide(context,current);return {changed:false,reason:'decision-required'}}
      selected={...context,applyPayment:resolution.applyPayment,applyInvoice:resolution.applyInvoice};
    }
    const result=debts.apply({debtId:context.debtId,operationId,documentId,documentNumber,type,amount,verifiedAt,applyPayment:selected.applyPayment,applyInvoice:selected.applyInvoice});
    if(result.reason==='missing-debt')feedback.toast('המסמך אומת ב-Morning, אך שורת החוב כבר אינה קיימת ולכן לא עודכנה. נקודת ההתאוששות נשמרה וההפקה נשארת נעולה עד לשחזור החוב ובדיקת המצב מחדש.');
    else if(result.reason==='write-blocked')feedback.toast('המסמך אומת ב-Morning, אך עדכון החוב נעצר כי אין כרגע הרשאת כתיבה מקומית. נקודת ההתאוששות נשמרה וינוסה שוב מהלשונית הראשית.');
    else if(result.persisted===false)feedback.toast('המסמך אומת והחוב עודכן בזיכרון, אך השמירה המקומית נכשלה. נקודת ההתאוששות נשמרה; אין לסגור את החלון עד שהשמירה המקומית חוזרת לפעול.');
    return result;
  }
  return {apply};
}
