import {SUPA_EMAIL_KEY} from '../state/constants.js';
import {esc} from '../core/values.js';

// Owns authentication commands; application startup supplies its narrow ports.
export function createCloudAuthentication({auth={},view={},storage={},transfer,opening,reset}){
  const {supaConfigured,friendlySupabaseError,supaAuthPassword,supaAuthPasswordForLocalReset}=auth;
  const {toast,modal,closeModal}=view;
  const {storageV2PrimaryRequested=()=>false,storageOwnerCurrent=()=> 'local'}=storage;
  const transferLocalV2=(...args)=>transfer.transferLocalV2(...args);
  const openCloudUsingSavedSession=(...args)=>opening.openCloudUsingSavedSession(...args);
  const enableCloudFromCurrentState=(...args)=>opening.enableCloudFromCurrentState(...args);
  const resetLocalSiteStorage=(...args)=>reset.resetLocalSiteStorage(...args);

function openSupabaseLoginModal(mode='open'){
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const email=localStorage.getItem(SUPA_EMAIL_KEY)||'',resetMode=mode==='reset';
  modal(resetMode?'אימות ענן לפני איפוס מקומי':mode==='upload'?'הפעלת סנכרון Supabase':'פתיחת קופה מהענן',`<div class="form-grid"><div class="form-group full"><div class="notice">${resetMode?'ההתחברות כאן משמשת רק לאימות שהקופה והצ׳קים קיימים ונגישים בענן לפני מחיקת האחסון המקומי. היא אינה פותחת, ממזגת או מעלה נתונים.':'הנתונים העסקיים נשמרים ב־Supabase ולא בזיכרון הדפדפן. בדפדפן נשמרים רק פרטי התחברות/Session כדי שלא תצטרך להתחבר בכל פתיחה.'}</div></div><div class="form-group full"><label>אימייל משתמש Supabase Auth</label><input id="supaEmail" type="email" value="${esc(email)}" autocomplete="username"></div><div class="form-group full"><label>סיסמה</label><input id="supaPassword" type="password" autocomplete="current-password"></div><div class="form-group full"><div id="supaLoginError" class="notice warn" style="display:none"></div></div>${resetMode?'':`<div class="form-group full"><div class="soft-note">${mode==='upload'?'אם עדיין אין קופה בענן, הנתונים הפתוחים כרגע יועלו כעותק הראשי. אם כבר קיימת קופה בענן, המערכת לא תדרוס אותה.':'המערכת תפתח את הקופה הקיימת בענן. אם עוד לא הועלתה קופה, פתח קודם את התיקייה המקומית והפעל ענן מתוך ההגדרות.'}</div></div>`}</div>`,resetMode?'אמת והמשך לאיפוס':mode==='upload'?'התחבר והפעל ענן':'התחבר ופתח',()=>connectSupabaseFromLogin(mode))
}

async function connectSupabaseFromLogin(mode){
  const email=document.getElementById('supaEmail')?.value.trim();
  const password=document.getElementById('supaPassword')?.value||'';
  if(!email||!password)return toast('יש להזין אימייל וסיסמה');
  try{
    if(mode==='reset'){
      const resetSession=await supaAuthPasswordForLocalReset(email,password);
      closeModal();
      return resetLocalSiteStorage({allowAuthPrompt:false,resetSession});
    }
    await supaAuthPassword(email,password);
    if(mode==='upload'){
      const ok=await enableCloudFromCurrentState();
      if(ok)closeModal();
      return ok;
    }
    if(storageOwnerCurrent()==='local'){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      const ok=await transferLocalV2('load-account');
      if(ok)closeModal();
      return ok;
    }
    const ok=await openCloudUsingSavedSession({interactive:false});
    if(ok)closeModal();
    return ok;
  }catch(error){
    console.error(error);
    const message='לא ניתן להתחבר ל-Supabase: '+friendlySupabaseError(error);
    const box=document.getElementById('supaLoginError');
    if(box){box.textContent=message;box.style.display='block'}else alert(message);
    return false;
  }
}

return {openSupabaseLoginModal,connectSupabaseFromLogin};
}
