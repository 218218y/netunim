// Reservation, local recovery and official issue have one captured authority.
// A lost response never authorizes another create or cleanup under a new login.
export function createMorningIssuance({backend,recovery}){
  if(typeof backend!=='function'||typeof recovery?.persist!=='function'||typeof recovery?.reset!=='function'||typeof recovery?.block!=='function')throw new TypeError('morning_issuance_ports_required');
  async function issue(payload,context,assertCurrent){
    assertCurrent();
    if(!payload.operation_id||context.operationId!==payload.operation_id)throw new Error('morning_issuance_context_mismatch');
    const reservation=await backend('reserve',payload,assertCurrent);assertCurrent();
    if(reservation.reserved!==true||reservation.operation?.state!=='reserved')throw new Error('השרת לא אישר הזמנה מוקדמת בטוחה לפעולת ההפקה. המסמך לא נשלח ל-Morning.');
    try{recovery.persist(context)}
    catch(error){
      try{assertCurrent();const cleanup=await backend('abandon_reservation',{operation_id:context.operationId},assertCurrent);assertCurrent();if(cleanup.abandoned===true)recovery.reset(context.operationId);else recovery.block()}
      catch(abandonError){recovery.block();if(abandonError.code!=='MORNING_OPERATION_SCOPE_CHANGED')console.error('Morning pre-issue reservation cleanup failed',abandonError)}
      throw error;
    }
    recovery.block();assertCurrent();
    const data=await backend('create',payload,assertCurrent);assertCurrent();
    if(data.verified!==true||!data.document?.id)throw new Error('השרת לא החזיר אימות קנוני למסמך. לא יישלח ניסיון נוסף לפני בדיקת מצב ההפקה.');
    return data;
  }
  return {issue};
}
