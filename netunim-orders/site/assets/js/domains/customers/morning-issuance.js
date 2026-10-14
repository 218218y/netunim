// @ts-check
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {import('./morning-operation-commands.js').MorningOperationCommands} MorningOperationCommands */
/** @typedef {import('./morning-operation-commands.js').IssuePayload} IssuePayload */
/** @typedef {{issue:<T extends {operationId:string}>(payload:IssuePayload,context:T,assertCurrent:MorningAssertion)=>Promise<import('./morning-operation-evidence.js').CreatedDocument>}} MorningIssuance */
// Reservation, local recovery and official issue have one captured authority.
// A lost response never authorizes another create or cleanup under a new login.
/** @param {{commands:MorningOperationCommands,recovery:{persist:(context:{operationId:string})=>unknown,reset:(operationId:string)=>unknown,block:()=>void}}} ports @returns {MorningIssuance} */
export function createMorningIssuance({commands,recovery}){
  if(typeof commands?.reserve!=='function'||typeof commands?.create!=='function'||typeof commands?.abandonReservation!=='function'||typeof recovery?.persist!=='function'||typeof recovery?.reset!=='function'||typeof recovery?.block!=='function')throw new TypeError('morning_issuance_ports_required');
  /** @template {{operationId:string}} T @param {IssuePayload} payload @param {T} context @param {MorningAssertion} assertCurrent */
  async function issue(payload,context,assertCurrent){
    assertCurrent();
    if(!payload.operation_id||context.operationId!==payload.operation_id)throw new Error('morning_issuance_context_mismatch');
    const reservation=await commands.reserve(payload,assertCurrent);assertCurrent();
    if(reservation.reserved!==true||reservation.operation?.state!=='reserved')throw new Error('השרת לא אישר הזמנה מוקדמת בטוחה לפעולת ההפקה. המסמך לא נשלח ל-Morning.');
    try{recovery.persist(context)}
    catch(error){
      try{assertCurrent();const cleanup=await commands.abandonReservation(context.operationId,assertCurrent);assertCurrent();if(cleanup.abandoned===true)recovery.reset(context.operationId);else recovery.block()}
      catch(abandonError){recovery.block();if(!(abandonError&&typeof abandonError==='object'&&'code' in abandonError&&abandonError.code==='MORNING_OPERATION_SCOPE_CHANGED'))console.error('Morning pre-issue reservation cleanup failed',abandonError)}
      throw error;
    }
    recovery.block();assertCurrent();
    const data=await commands.create(payload,assertCurrent);assertCurrent();
    if(data.verified!==true||!data.document?.id)throw new Error('השרת לא החזיר אימות קנוני למסמך. לא יישלח ניסיון נוסף לפני בדיקת מצב ההפקה.');
    return data;
  }
  return {issue};
}
