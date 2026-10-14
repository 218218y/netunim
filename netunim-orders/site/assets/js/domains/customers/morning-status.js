// @ts-check
import {morningStatusMessage} from './morning-status-message.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {import('./morning-operation-evidence.js').OperationStatus} OperationStatus */
/** @typedef {import('./morning-operation-evidence.js').LedgerOperation} LedgerOperation */
/** @typedef {import('./morning-operation-evidence.js').BankLink} BankLink */
/** @typedef {import('./morning-debt-application.js').ApplicationContext} ApplicationContext */
/** @typedef {import('./morning-debt-application.js').ApplicationResult} ApplicationResult */
/** @typedef {{operationId:string,generation:number,busy:boolean,blocked:boolean,completed:boolean,pendingOperationId:string|null,context:ApplicationContext|null}} StatusSession */
/** @typedef {{refresh:(options?:{reconcile?:boolean})=>Promise<OperationStatus|null>,cancelPending:()=>void}} StatusCapability */
/** @param {unknown} error */
function changed(error){return error!==null&&typeof error==='object'&&'code' in error&&error.code==='MORNING_OPERATION_SCOPE_CHANGED'}
/** @param {unknown} error */
function failureMessage(error){return error!==null&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:''}

/**
 * Accepted business work can finish after visual replacement. Only the current
 * read may publish to its captured form; an operation change also fences session
 * settlement. The shared lifetime owns authority, accepted drain and wakeups.
 * @param {{
 * lifetime:Pick<import('./morning-lifetime.js').MorningLifetime,'capture'|'run'|'scheduleRecovery'>,
 * commands:Pick<import('./morning-operation-commands.js').MorningOperationCommands,'status'>,
 * session:{assertModal:()=>void,read:()=>StatusSession,isActive:(generation:number)=>boolean,update:(state:{blocked:boolean,completed?:boolean})=>void},
 * recovery:{abandon:(id:string,options:{assertCurrent:MorningAssertion})=>Promise<{abandoned:boolean,operation:LedgerOperation|null}>,reset:(id:string)=>boolean},
 * application:{apply:(args:import('./morning-debt-application.js').VerifiedDocument,options:{assertCurrent:MorningAssertion,isCurrent:()=>boolean})=>Promise<ApplicationResult>,settle:(id:string,result:ApplicationResult,options:{serverLinkPending:boolean})=>import('./morning-recovery.js').Settlement,notify:(context:ApplicationContext|null,link:BankLink|null|undefined)=>void},
 * presentation:{status:(kind:import('./morning-status-message.js').StatusKind,text:string)=>void,operation:(row:LedgerOperation|null)=>void,markSaved:()=>void,button:(state:{disabled:boolean,completed?:boolean})=>void}
 * }} ports
 * @returns {StatusCapability}
 */
export function createMorningStatus({lifetime,commands,session,recovery,application,presentation}){
  let sequence=0;
  /** @param {{reconcile?:boolean}} options @returns {Promise<OperationStatus|null>} */
  async function refreshStatus({reconcile=false}={}){
    /** @type {MorningAssertion} */ let assertCurrent;
    try{session.assertModal();assertCurrent=lifetime.capture(!reconcile)}catch{return null}
    const {generation,operationId}=session.read(),request=++sequence;
    const canPublish=()=>request===sequence&&session.isActive(generation);
    const sameOperation=()=>session.read().operationId===operationId;
    return lifetime.run(async()=>{
      if(canPublish())presentation.status('loading','בודק חיבור ל-Morning…');
      try{
        let data=await commands.status(operationId,reconcile,assertCurrent);assertCurrent();
        if(!canPublish()||!sameOperation()||session.read().busy)return data;
        if(reconcile&&data.retryable_reserved&&operationId){
          const abandoned=await recovery.abandon(operationId,{assertCurrent});assertCurrent();
          if(abandoned.abandoned){
            if(canPublish()){presentation.status('ready','הניסיון הקודם נעצר לפני שליחה. אפשר לערוך ולהפיק מחדש בבטחה.');presentation.button({disabled:false})}
            return data;
          }
          data={...data,operation:abandoned.operation};
          if(!canPublish()||!sameOperation()||session.read().busy)return data;
        }
        // Stored recovery remains locked until a verified local settlement.
        const recoveryStillPending=session.read().pendingOperationId===operationId;
        session.update({blocked:!!data.unresolved||!!data.retryable_reserved||recoveryStillPending});
        presentation.operation(data.operation);
        const verifiedCreated=data.operation?.state==='created'&&!!data.operation?.verified_at,
          needsLocalRecovery=!session.read().completed||session.read().pendingOperationId===operationId;
        let recoveryCleanupPending=false;
        if(verifiedCreated&&needsLocalRecovery&&data.operation){
          const context=session.read().context,assertWrite=lifetime.capture(),
            result=await application.apply({operationId:data.operation.operation_id,documentId:data.operation.document_id,documentNumber:data.operation.document_number,type:data.operation.document_type,amount:Number(data.operation.amount),verifiedAt:data.operation.verified_at},{assertCurrent:assertWrite,isCurrent:()=>canPublish()&&sameOperation()});
          assertCurrent();assertWrite();
          if(!sameOperation())return data;
          const settlement=application.settle(operationId,result,{serverLinkPending:!!data.bank_link_pending});
          session.update({blocked:settlement.blocked,completed:settlement.durable});
          recoveryCleanupPending=settlement.durable&&!settlement.recoveryCleared;
          if(settlement.recoveryCleared)application.notify(context,data.bank_link);
          if(canPublish())presentation.markSaved();
        }
        if(data.operation?.state==='failed')recovery.reset(operationId);
        const current=session.read();
        if(current.blocked&&recoveryStillPending)lifetime.scheduleRecovery(60_000,assertCurrent);
        if(!canPublish())return data;
        const message=morningStatusMessage(data,{blocked:current.blocked,recoveryStillPending,recoveryCleanupPending});
        presentation.status(message.kind,message.text);
        presentation.button({disabled:!data.configured||data.available===false||current.blocked||current.completed||current.busy,completed:current.completed});
        return data;
      }catch(error){
        if(changed(error))return null;
        if(sameOperation()&&session.read().pendingOperationId===operationId)lifetime.scheduleRecovery(90_000,assertCurrent);
        if(canPublish()&&sameOperation()){presentation.status('error',failureMessage(error)||'לא ניתן לאמת את החיבור');presentation.button({disabled:true})}
        return null;
      }
    });
  }
  return {refresh:refreshStatus,cancelPending:()=>{sequence++}};
}
