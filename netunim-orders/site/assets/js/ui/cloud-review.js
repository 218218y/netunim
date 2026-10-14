

// Owns review commands; application startup supplies its narrow ports.
export function createCloudReview({tab,auth={},view={},review={}}){
  const {loadSession}=auth;
  const {confirmDialog,toast,showSecondaryTabGuard,render,renderSettings}=view;
  const {prepareConcurrentAckRecovery=null,downloadRecoveryBackup=null}=review;

async function recoverOrdersSync(){
  if(!tab.primaryTab)return showSecondaryTabGuard();
  if(!navigator.onLine||!loadSession()){toast('נדרש חיבור לענן כדי לבדוק את השינויים המקומיים.');return false}
  if(!prepareConcurrentAckRecovery||!downloadRecoveryBackup){toast('פעולת השחזור אינה זמינה בגרסה זו.');return false}
  try{
    const review=await prepareConcurrentAckRecovery();
    downloadRecoveryBackup(review.backup);
    const approved=await confirmDialog('בדיקה וחידוש סנכרון',`נתוני הענן r${review.revision} תואמים לבסיס שנשמר במחשב. אישור הענן נשמר עד פעולה ${review.ackSeq}; ${review.pendingCount} פעולות מקומיות עדיין ממתינות.

הבדלים מהענן:
${review.diffText||'הפירוט נמצא בקובץ הגיבוי.'}

הורד קובץ גיבוי הכולל את הנתונים המקומיים, הענן ויומן השינויים. ודא שהקובץ נשמר לפני המשך.

חידוש הסנכרון ישמור את השינויים המקומיים במסלול השמירה הרגיל. אם הנתונים או החשבון ישתנו, הבדיקה תיעצר ותידרש בדיקה חדשה.`,{confirmText:'הגיבוי נשמר — חדש סנכרון',cancelText:'ביטול'});
    if(!approved)return false;
    const result=await review.resume();
    if(result){render();renderSettings()}
    else toast('השינויים נשמרו מקומית; הסנכרון עדיין לא אושר. בדוק את מצב הענן.');
    return result;
  }catch(error){
    console.error('Orders guarded sync recovery',error);
    const messages={orders_recovery_remote_changed:'הענן התקדם או אינו תואם לבסיס המקומי. נדרשת בדיקת מיזוג; השחזור לא שינה את הנתונים.',orders_recovery_unsaved_view:'התצוגה כוללת שינוי שאין לו עדיין אישור שמירה מקומי. השחזור לא התחיל.',orders_recovery_not_concurrent_ack:'החסימה אינה מסוג שמתאים לשחזור הזה. נדרשת בדיקה של ההתנגשות.',orders_recovery_view_changed:'הנתונים השתנו בזמן הבדיקה. יש לבצע בדיקה חדשה.',storage_cloud_recovery_stale:'יומן השינויים השתנה בזמן הבדיקה. יש לבצע בדיקה חדשה.'};
    toast(messages[error?.code||error?.message]||'בדיקת הסנכרון נעצרה; הגיבוי והשינויים המקומיים נשמרו.');
    return false;
  }
}

return {recoverOrdersSync};
}
