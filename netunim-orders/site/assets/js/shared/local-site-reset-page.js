import {clearCurrentOriginStorage,localSiteResetChannelName} from './local-site-reset.js';

const status=document.getElementById('resetStatus'),detail=document.getElementById('resetDetail'),retry=document.getElementById('resetRetry');
const params=new URLSearchParams(location.search),peer=params.get('peer')==='1';
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(localSiteResetChannelName()):null;

function setStatus(title,text){if(status)status.textContent=title;if(detail)detail.textContent=text||''}
function returnToApp(){location.replace('./')}
function friendly(error){
  const text=String(error?.message||error||'');
  if(text.includes('idb_blocked')||text.includes('idb_timeout'))return 'האיפוס נעצר כי טאב נוסף של האתר עדיין מחזיק את מסד הנתונים פתוח. סגור את שאר הטאבים של האתר ולחץ “נסה שוב”.';
  if(text.includes('indexeddb_unavailable')||text.includes('indexeddb_inventory_unavailable'))return 'הדפדפן אינו מאפשר למפות ולמחוק בבטחה את כל מסדי IndexedDB. יש להשתמש ב־Chrome או Edge עדכני, או לבצע Clear site data ידני.';
  if(text.includes('cache_storage_unavailable'))return 'הדפדפן אינו מאפשר לנקות ולאמת את Cache Storage. יש לבצע Clear site data ידני.';
  if(text.includes('_remaining'))return 'האיפוס לא עבר אימות מלא. אל תחזור לאפליקציה עדיין; סגור טאבים נוספים של האתר ולחץ “נסה שוב”, או בצע Clear site data ידני.';
  return `האיפוס לא הושלם: ${text}`;
}

async function run(){
  retry.hidden=true;setStatus('מאפס את האחסון המקומי…','אין לסגור את הטאב עד להשלמת הפעולה. הענן וקבצים חיצוניים אינם משתנים.');
  try{
    await clearCurrentOriginStorage({onProgress:event=>{
      if(event.phase==='indexeddb')setStatus('מנקה מסדי נתונים מקומיים…',`נמצאו ${event.count} מאגרי דפדפן לבדיקה ומחיקה.`);
      if(event.phase==='indexeddb-blocked')setStatus('ממתין לטאב נוסף…','טאב אחר עדיין מחזיק אחסון פתוח; הוא צריך להיסגר או לעבור למסך האיפוס.');
      if(event.phase==='caches')setStatus('מנקה Cache וגרסת אתר שמורה…',`${event.count} מאגרי Cache נמצאו.`);
      if(event.phase==='web-storage')setStatus('מסיים את האיפוס…','LocalStorage ו־SessionStorage נוקו.');
    }});
    setStatus('האיפוס הושלם','טוען את האתר מחדש כהתקנה מקומית נקייה. יהיה צורך להתחבר שוב ל־Supabase.');
    try{channel?.postMessage({type:'local-site-reset-complete'})}catch{}
    returnToApp();
  }catch(error){console.error('local site reset',error);setStatus('האיפוס עדיין לא הושלם',friendly(error));retry.hidden=false}
}

if(peer){
  setStatus('הטאב הושהה לצורך איפוס','האיפוס מתבצע בטאב הראשי. הטאב הזה אינו פותח את מסדי הנתונים המקומיים עד לסיום.');retry.hidden=true;
  channel?.addEventListener('message',event=>{if(event?.data?.type==='local-site-reset-complete')returnToApp()});
}else{
  retry.addEventListener('click',()=>void run());
  void run();
}
