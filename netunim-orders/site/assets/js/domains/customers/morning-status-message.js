// @ts-check
import {morningCheckRegistrationMessage} from './morning-operation-evidence.js';
/** @typedef {'loading'|'error'|'warning'|'ready'} StatusKind */
/** @typedef {{kind:StatusKind,text:string}} StatusMessage */
/** Pure connection/recovery presentation. It never grants write authority.
 * @param {import('./morning-operation-evidence.js').OperationStatus} data
 * @param {{blocked:boolean,recoveryStillPending:boolean,recoveryCleanupPending:boolean}} state
 * @returns {StatusMessage}
 */
export function morningStatusMessage(data,{blocked,recoveryStillPending,recoveryCleanupPending}){
  /** @type {StatusMessage} */ let result={kind:'error',text:''};
  /** @param {StatusKind} kind @param {string} text */
  function connectionStatus(kind,text){result={kind,text}}
const envLabel=data.environment==='sandbox'?'Sandbox':'Production';
    if(!data.configured)connectionStatus('error','Morning אינו מוגדר בשרת');
    else if(data.available===false)connectionStatus('error',blocked?'Morning אינו זמין כרגע והפקה קודמת עדיין חסומה עד לאימות.':'Morning אינו זמין כרגע. הפקת מסמכים חסומה ליתר ביטחון.');
    else if(data.retryable_reserved)connectionStatus('warning','הפעולה נרשמה אך טרם נשלחה ל-Morning. לחץ „בדוק מצב הפקה” כדי לבטל את ההזמנה המוקדמת בבטחה ואז להפיק מחדש.');
    else if(recoveryStillPending&&!data.operation)connectionStatus('warning','נשמר ניסיון הפקה מקומי אך הוא עדיין לא הופיע ביומן השרת. לא נשלח ניסיון נוסף עד שהמצב יתברר.');
    else if(data.checks_registration_pending)connectionStatus('warning',morningCheckRegistrationMessage(data)||'המסמך אומת; רישום הצ׳קים למעקב ממתין להשלמה אוטומטית. אין להפיק שוב.');
    else if(recoveryCleanupPending)connectionStatus('warning','המסמך אומת והעדכון המקומי נשמר, אך נקודת ההתאוששות עדיין לא נמחקה בבטחה. ההפקה נשארת נעולה והמערכת תנסה שוב.');
    else connectionStatus(blocked||data.environment==='sandbox'?'warning':'ready',blocked?'ניסיון ההפקה עדיין בבדיקה. לחץ „בדוק מצב הפקה”.':`מחובר ל-Morning ${envLabel}`);
      return result;
}
