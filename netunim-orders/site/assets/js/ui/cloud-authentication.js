import {CLOUD_EMAIL_KEY,$} from '../state/constants.js';
import {esc} from '../core/values.js';

// Owns authentication commands; application startup supplies its narrow ports.
export function createCloudAuthentication({auth={},view={},opening,reset}){
  const {supaConfigured,authPassword,authPasswordForLocalReset}=auth;
  const {modal,toast,closeModal,resumeCalendarAfterCloudLogin}=view;
  const enableCloud=(...args)=>opening.enableCloud(...args);
  const openCloud=(...args)=>opening.openCloud(...args);
  const resetLocalSiteStorage=(...args)=>reset.resetLocalSiteStorage(...args);

function loginModal(mode='open'){if(!supaConfigured())return alert('הגדרת Supabase חסרה. בדוק supabase/config.js');const email=localStorage.getItem(CLOUD_EMAIL_KEY)||'',calendarMode=mode==='calendar',resetMode=mode==='reset',title=resetMode?'אימות ענן לפני איפוס מקומי':calendarMode?'התחברות לענן לצורך Google Calendar':mode==='upload'?'הפעלת ענן נפרד לניהול הזמנות':'פתיחת ניהול הזמנות מהענן',notice=resetMode?'ההתחברות כאן משמשת רק לאימות שמסמך ניהול ההזמנות ומסמך הצ׳קים קיימים ונגישים בענן לפני מחיקת האחסון המקומי. היא אינה פותחת, ממזגת או מעלה נתונים.':calendarMode?'השרת המקומי הוא כתובת נפרדת מהאתר שברשת, ולכן הדפדפן דורש כאן התחברות חד-פעמית ל-Supabase. ההתחברות מזהה את המשתמש לצורך Google Calendar בלבד ואינה מפעילה מעצמה את סנכרון מסמך ניהול ההזמנות.':`ניהול ההזמנות נשמר בטבלאות <b>order_management_*</b>. טאב הצ'קים קורא וכותב ישירות למאגר הצ'קים המשותף <b>shared_checks_documents/main</b>. בנוסף, נתוני העו״ש והאשראי נקראים מאותו מסמך קופה <b>kupa_documents/main</b>, וסנכרון בנק/אשראי מניהול ההזמנות מעדכן בו רק את התחומים הפיננסיים המתאימים דרך מנגנון ה-revision של הקופה. הוצאות ומזומן נשארים בבעלות ניהול הקופה, ואין עותק פיננסי נוסף בניהול ההזמנות.`;const action=resetMode?'finish-local-reset-login':'finish-cloud-login';modal(title,`<div class="form-grid"><div class="field full"><div class="notice">${notice}</div></div><div class="field full"><label>אימייל Supabase Auth</label><input id="cEmail" type="email" value="${esc(email)}"></div><div class="field full"><label>סיסמה</label><input id="cPassword" type="password"></div></div>`,`<button class="btn primary" data-action="${action}" data-click-arg0="${esc(mode)}">${resetMode?'אמת והמשך לאיפוס':'התחבר'}</button><button class="btn" data-action="close-modal">ביטול</button>`)}

async function finishCloudLogin(mode){const email=$('#cEmail').value.trim(),pass=$('#cPassword').value;if(!email||!pass)return toast('יש להזין אימייל וסיסמה');try{await authPassword(email,pass)}catch(e){console.error(e);toast('התחברות נכשלה: '+e.message);return}closeModal();try{if(mode==='calendar'){if(typeof resumeCalendarAfterCloudLogin!=='function')throw new Error('המשך החיבור ליומן אינו זמין');await resumeCalendarAfterCloudLogin();return}if(mode==='upload')await enableCloud(true);else await openCloud()}catch(e){console.error(e);toast((mode==='calendar'?'חיבור Google Calendar נכשל: ':'פתיחת הענן נכשלה: ')+e.message)} }

async function finishLocalResetLogin(){const email=$('#cEmail').value.trim(),pass=$('#cPassword').value;if(!email||!pass)return toast('יש להזין אימייל וסיסמה');let resetSession;try{resetSession=await authPasswordForLocalReset(email,pass)}catch(e){console.error(e);toast('אימות הענן נכשל: '+e.message);return false}closeModal();return resetLocalSiteStorage({allowAuthPrompt:false,resetSession})}

return {loginModal,finishCloudLogin,finishLocalResetLogin};
}
