import {beginLocalSiteResetNavigation} from '../shared/local-site-reset.js';

// Owns reset commands; application startup supplies its narrow ports.
export function createCloudReset({tab,auth={},view={},main={},authentication}){
  const {loadSupaSession,friendlySupabaseError}=auth;
  const {toast,showSecondaryTabGuard,confirmDialog}=view;
  const {verifyLocalResetCloud}=main;
  const openSupabaseLoginModal=(...args)=>authentication.openSupabaseLoginModal(...args);

async function resetLocalSiteStorage({allowAuthPrompt=true,resetSession=null}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!navigator.onLine){toast('איפוס אחסון מקומי דורש חיבור לרשת כדי לוודא קודם שהענן זמין.');return false}
  const cloudSession=resetSession||loadSupaSession();
  if(!cloudSession){if(allowAuthPrompt)openSupabaseLoginModal('reset');else toast('נדרש אימות Supabase מחדש לצורך האיפוס.');return false}
  try{
    const {main,shared}=await verifyLocalResetCloud(cloudSession);
    const mainRevision=Number(main?.revision),sharedRevision=Number(shared?.revision);
    if(!main||!Number.isSafeInteger(mainRevision)||mainRevision<1)throw new Error('מסמך הקופה בענן אינו זמין או אינו תקין');
    if(!shared||!Number.isSafeInteger(sharedRevision)||sharedRevision<1)throw new Error('מסמך הצ׳קים המשותף בענן אינו זמין או אינו תקין');
    const account=String(cloudSession?.user?.email||'').trim(),accountLine=account?`חשבון שאומת: ${account}.
`:'';
    const approved=await confirmDialog('איפוס אחסון מקומי',`${accountLine}הענן אומת: קופה r${mainRevision}, צ׳קים r${sharedRevision}.

הפעולה תמחק מהמחשב הזה את כל נתוני האתר של הכתובת הנוכחית בדפדפן — Storage V2, נתוני מעבר ישנים, תורי סנכרון, owner binding, IndexedDB, LocalStorage, Cache ו־Service Worker. כל שינוי מקומי שלא הגיע לענן יימחק.

Supabase, קובצי data וגיבויים מחוץ לדפדפן לא ישתנו. לאחר האיפוס יהיה צורך להתחבר שוב ולפתוח מהענן.`,{confirmText:'אפס אחסון מקומי',cancelText:'ביטול',tone:'danger'});
    if(!approved)return false;
    await beginLocalSiteResetNavigation();return true;
  }catch(error){
    if(allowAuthPrompt&&String(error?.code||'')==='local_reset_auth_required'){openSupabaseLoginModal('reset');return false}
    console.error('kupa local site reset preflight',error);toast('האיפוס לא התחיל: '+friendlySupabaseError(error));return false
  }
}

return {resetLocalSiteStorage};
}
