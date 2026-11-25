// @ts-check
import {morningCheckRegistrationMessage} from './morning-operation-evidence.js';
/** @type {Record<string,string|undefined>} */
const RECOVERY_PROBLEMS={
  'missing-debt':'החוב המקורי חסר בענן. יש לאתר ולשחזר אותו כדי להשלים את עדכון החוב.',
  'verification-mismatch':'פרטי המסמך המאומת אינם תואמים לנקודת ההתאוששות. יש לבדוק את פרטי הפעולה.',
  'conflicting-recovery':'הקישור או רישומי הזקיפה בחוב דורשים בדיקה לפני השלמה.',
  'write-blocked':'עדכון החוב מחכה לעמדה הראשית של אתר ההזמנות.',
};
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {import('./morning-debt-application.js').ApplicationContext} ApplicationContext */
/** @typedef {import('./morning-debt-application.js').ApplicationResult} ApplicationResult */
/** @typedef {import('./morning-debt-application.js').VerifiedDocument} VerifiedDocument */
/** @typedef {import('./morning-operation-evidence.js').LedgerOperation} LedgerOperation */
/** @typedef {import('./morning-operation-evidence.js').BankLink} BankLink */
/** @typedef {import('./morning-operation-evidence.js').OperationStatus} OperationStatus */
/** @typedef {{durable:boolean,recoveryCleared:boolean,blocked:boolean}} Settlement */
/** @typedef {{ok:boolean,state:string,error?:unknown,result?:ApplicationResult,status?:OperationStatus}} RecoveryResult */
/** @typedef {{quiet?:boolean,assertCurrent?:MorningAssertion,retryChecks?:boolean,expectedOperationId?:string}} RecoveryOptions */
/** @typedef {{recover:(options?:RecoveryOptions)=>Promise<RecoveryResult>}} RecoveryCapability */
/** @param {unknown} error */
function changed(error){return error!==null&&typeof error==='object'&&'code' in error&&error.code==='MORNING_OPERATION_SCOPE_CHANGED'}
/** @param {unknown} error */
function failureMessage(error){return error!==null&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:''}
/**
 * Reconciliation uses decoded ledger evidence and the existing local application
 * capability. The lifetime owns authority/coalescing/drain. This coordinator has
 * no DOM, raw debt model, JSON transport, storage or timer implementation.
 * @param {{
 * lifetime:Pick<import('./morning-lifetime.js').MorningLifetime,'capture'|'join'|'pending'|'scheduleRecovery'>,
 * commands:Pick<import('./morning-operation-commands.js').MorningOperationCommands,'status'>,
 * recovery:{read:()=>ApplicationContext|null,abandon:(id:string,options:{quiet:boolean,assertCurrent:MorningAssertion})=>Promise<{abandoned:boolean,operation:LedgerOperation|null}>,reset:(id:string)=>boolean},
 * application:{apply:(context:ApplicationContext,args:VerifiedDocument,options:{assertCurrent:MorningAssertion})=>Promise<ApplicationResult>,settle:(id:string,result:ApplicationResult,options:{serverLinkPending:boolean})=>Settlement},
 * publish:{isBusy:()=>boolean,state:(blocked:boolean,completed?:boolean)=>void,notify:(context:ApplicationContext,link:BankLink|null|undefined)=>void,toast:(text:string)=>void,notice?:(context:ApplicationContext,text:string)=>void}
 * }} ports
 * @returns {RecoveryCapability}
 */
export function createMorningRecovery({lifetime,commands,recovery,application,publish}){
/** @param {RecoveryOptions} options @returns {Promise<RecoveryResult>} */
async function recoverPendingMorningOperation({quiet=false,assertCurrent,retryChecks=false,expectedOperationId}={}){
  try{const assertSource=assertCurrent||(()=>{}),assertWrite=lifetime.capture();assertCurrent=()=>{assertSource();assertWrite()};assertCurrent()}catch(error){return {ok:false,state:'scope-changed',error}}
  return lifetime.join('recovery',assertCurrent,async()=>{
  const context=recovery.read();if(!context||publish.isBusy())return {ok:true,state:context?'busy':'none'};
    if(expectedOperationId&&context.operationId!==expectedOperationId)return {ok:false,state:'scope-changed'};
    try{
      let data=await commands.status(context.operationId,true,assertCurrent,retryChecks);assertCurrent();let operation=data.operation;
      if(operation?.state==='reserved'){
        const abandoned=await recovery.abandon(context.operationId,{quiet,assertCurrent});assertCurrent();
        if(abandoned.abandoned)return {ok:true,state:'abandoned'};
        operation=abandoned.operation;
      }
      if(operation?.state==='created'&&operation.verified_at){
        const result=await application.apply(context,{operationId:operation.operation_id,documentId:operation.document_id,documentNumber:operation.document_number,type:operation.document_type,amount:Number(operation.amount),verifiedAt:operation.verified_at,...(data.debt_recovery_contract?{businessRecovery:true}:{})},{assertCurrent});assertCurrent();
        const settlement=application.settle(context.operationId,result,{serverLinkPending:!!(data.bank_link_pending||data.checks_registration_pending)});if(settlement.recoveryCleared)publish.notify(context,data.bank_link);
        if(result.reason==='decision-required')publish.notice?.(context,'המסמך אומת. נדרשת הכרעה לעדכון החוב.');
        else if(result.persisted===false)publish.notice?.(context,'המסמך אומת. יש להשלים את השמירה העמידה של עדכון החוב.');
        else if(result.reason){const problem=RECOVERY_PROBLEMS[result.reason];if(problem)publish.notice?.(context,problem)}
        if(settlement.durable&&settlement.recoveryCleared){publish.state(false,true);publish.toast(result.reason==='historical-receipt'?'המסמך אומת ונמצאה רשומת התאוששות היסטורית. פרטי החוב זמינים באתר ההזמנות.':context.debtId?'הפקת Morning הקודמת אומתה לאחר ההתאוששות והחוב עודכן לפי הבחירות שנשמרו.':'הפקת Morning הקודמת אומתה לאחר ההתאוששות.');return {ok:true,state:'created',result,status:data}}
        publish.state(true,settlement.durable);lifetime.scheduleRecovery(60_000,assertCurrent);if(settlement.durable&&!quiet)publish.toast(morningCheckRegistrationMessage(data)||'המסמך אומת והעדכון המקומי נשמר, אך נקודת ההתאוששות עדיין לא נמחקה בבטחה. ההפקה נשארת נעולה עד לניקוי מוצלח.');return {ok:false,state:settlement.durable?'cleanup-pending':'local-pending',result,status:data};
      }
      if(operation?.state==='failed'){if(!recovery.reset(context.operationId))return {ok:false,state:'cleanup-pending'};publish.toast('ניסיון Morning הקודם הסתיים ללא מסמך מאומת; החוב לא שונה.');return {ok:true,state:'failed'}}
      publish.state(true);lifetime.scheduleRecovery(operation?60_000:30_000,assertCurrent);if(!quiet)publish.toast('נמצא ניסיון Morning שעדיין ממתין לאימות. המערכת תשמור את הקשר לחוב ולא תזקוף אותו עד לאימות ודאי.');return {ok:true,state:operation?.state||'waiting'};
    }catch(error){if(changed(error))return {ok:false,state:'scope-changed',error};lifetime.scheduleRecovery(90_000,assertCurrent);if(!quiet)publish.toast('ניסיון Morning קודם עדיין ממתין להתאוששות: '+(failureMessage(error)||'לא ניתן לבדוק כרגע'));return {ok:false,state:'unavailable',error}}
  });
}
/** @param {RecoveryOptions} options @returns {Promise<RecoveryResult>} */
async function recover(options={}){
  if(!options.retryChecks&&!lifetime.pending('manual-recovery'))return recoverPendingMorningOperation(options);
  try{
    const assertSource=options.assertCurrent,assertWrite=lifetime.capture();
    const guard=()=>{assertSource?.();return assertWrite()};
    return await lifetime.join('manual-recovery',guard,async()=>{
      const run=()=>recoverPendingMorningOperation({...options,assertCurrent:guard});
      if(lifetime.pending('recovery')){
        const previous=await lifetime.join('recovery',guard,run);guard();
        const current=recovery.read();
        if(!current||previous.status?.checks_registration_pending===false)return previous;
        if(options.expectedOperationId&&current.operationId!==options.expectedOperationId)return {ok:false,state:'scope-changed'};
      }
      return run();
    });
  }catch(error){return {ok:false,state:changed(error)?'scope-changed':'unavailable',error}}
}
return {recover};
}
