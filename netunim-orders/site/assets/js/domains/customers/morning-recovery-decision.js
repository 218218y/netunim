import {createMorningDebtRecoveryContext,morningFinancialSnapshot,morningFinancialChanges} from './morning-debt-recovery.js';
import {createMorningDocumentView} from './morning-document-view.js';
import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
const {decision:morningRecoveryDecisionMarkup}=createMorningDocumentView({format:{esc,money},financial:{changes:morningFinancialChanges}});

// Only a saved explicit choice, a current refresh and an unchanged financial
// snapshot can confirm a recovery decision. This owner never issues documents.
export function createMorningRecoveryDecision({session,debts,recovery,application,display,feedback}){
let decisionView=null;
function showRecoveryDecision(context,current){
  const displayedCurrent=morningFinancialSnapshot(debts.read(context.debtId))||current;
  decisionView={operationId:context.operationId,financialSnapshot:current};
  if(!display.isOpen()){
    display.open('הכרעה בעדכון חוב מ-Morning',generation=>`<div data-morning-generation="${generation}"><div id="morningConnectionStatus"></div><div id="morningRecoveryDecision"></div></div>`,'<button class="btn" data-action="close-modal">סגור — ההפקה תישאר ממתינה</button>');
  }
  const panel=display.field('morningRecoveryDecision');
  if(!panel){feedback.toast('החוב השתנה בזמן שהפקת Morning המתינה לאימות. פתח את הפקת Morning של החוב להכרעה לפני זקיפה.');return}
  panel.hidden=false;panel.innerHTML=morningRecoveryDecisionMarkup(context,current,displayedCurrent);
  display.status('warning','המסמך מאומת. החוב ממתין להכרעה מפורשת.');display.markSaved();
}
function saveRecoveryChoice(){
  if(!session.isActive(session.generation()))return false;
  try{session.assertModal();session.capture()()}catch(error){feedback.toast(error.message);return false}
  const context=recovery.read();if(!context||context.operationId!==decisionView?.operationId||debts.isBlocked())return false;
  const next=createMorningDebtRecoveryContext({...context,resolution:{financialSnapshot:decisionView.financialSnapshot,applyPayment:display.field('morningRecoveryPayment')?.checked===true,applyInvoice:display.field('morningRecoveryInvoice')?.checked===true,confirmedAt:''}});
  if(!recovery.save(next)){feedback.toast('לא ניתן לשמור את ההכרעה. החוב לא יעודכן ונקודת ההתאוששות נשארת נעולה.');return false}
  recovery.adopt(next);display.markSaved();return true;
}
async function confirmRecoveryChoice(button){
  if(application.isPending()||recovery.isPending()||!saveRecoveryChoice())return;
  const generation=session.generation();
  const assertCurrent=session.capture(),chosen=recovery.read();if(!chosen?.resolution)return;
  display.busy(button,true,'מסנכרן ובודק…');
  try{
    const refreshed=await debts.refresh();assertCurrent();
    if(refreshed!==true){feedback.toast('לא ניתן להשלים רענון מהענן. ההכרעה נשמרה אך החוב לא עודכן.');return}
    if(debts.isBlocked())return;
    const current=morningFinancialSnapshot(debts.read(chosen.debtId),chosen.operationId);
    if(!current){feedback.toast('החוב אינו קיים. נקודת ההתאוששות נשמרה.');return}
    if(morningFinancialChanges(chosen.resolution.financialSnapshot,current).changed){showRecoveryDecision(chosen,current);feedback.toast('החוב השתנה שוב בזמן הבדיקה. בדוק ואשר את המצב המעודכן.');return}
    const latest=recovery.read();if(latest?.operationId!==chosen.operationId||JSON.stringify(latest.resolution)!==JSON.stringify(chosen.resolution))return;
    const approved=createMorningDebtRecoveryContext({...chosen,resolution:{...chosen.resolution,confirmedAt:new Date().toISOString()}});
    if(!recovery.save(approved)){feedback.toast('שמירת האישור נכשלה. לא בוצעה זקיפה.');return}
    recovery.adopt(approved);if(session.isActive(generation))display.markSaved();await recovery.run();
  }catch(error){if(!session.scopeChanged(error))feedback.toast('ההכרעה נשמרה להתאוששות; לא ניתן להשלים כרגע: '+error.message)}finally{display.busy(button,false)}
}
function clear(){decisionView=null;const panel=display.field('morningRecoveryDecision');if(panel){panel.hidden=true;panel.replaceChildren()}}
return {show:showRecoveryDecision,save:saveRecoveryChoice,confirm:confirmRecoveryChoice,clear};
}
