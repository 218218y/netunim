import {readCreditConnectionInput} from './credit-connection-input.js';
import {esc,uid} from '../core/values.js';
import {CREDIT_PROVIDER_LABELS} from '../domains/credit/sync-feed.js';
import {createRuntimeResources} from '../shared/runtime-resources.js';

function providerFields(provider){return provider==='isracard'||provider==='amex'?['id','card6Digits','password']:['username','password']}

// The connection form owns its DOM registrations. Provider commands receive
// explicit inputs and never read browser fields themselves.
export function createCreditConnectionDialog({modal,armModalDraftGuard,readProfile,saveConnection,closeModal,isActive}){
  let resources=null,generation=0;
  function openCreditConnectionModal(profileId=''){
    if(!isActive())return false;
    resources?.dispose();resources=createRuntimeResources();
    let form=null;
    const owner=++generation,current=()=>isActive()&&owner===generation&&form?.isConnected&&
      document.getElementById('creditConnectionForm')===form&&document.getElementById('modalBackdrop')?.classList.contains('open');
    const existing=readProfile(profileId),canPreserveCredentials=existing?.local===true;
    const provider=existing?.provider||'visaCal',isEdit=!!existing;
    const body=`<form id="creditConnectionForm" class="form-grid credit-connect-grid" autocomplete="off">
      <div class="form-group"><label>חברה</label><select id="ccProvider"><option value="visaCal" ${provider==='visaCal'?'selected':''}>כאל</option><option value="max" ${provider==='max'?'selected':''}>MAX</option><option value="isracard" ${provider==='isracard'?'selected':''}>ישראכרט</option><option value="amex" ${provider==='amex'?'selected':''}>American Express</option></select></div>
      <div class="form-group"><label>שם החיבור</label><input id="ccLabel" value="${esc(existing?.label||CREDIT_PROVIDER_LABELS[provider]||'')}" placeholder="למשל: MAX - אדם 1"></div>
      <div class="form-group"><label>בעל החשבון</label><input id="ccOwner" value="${esc(existing?.ownerLabel||'')}" placeholder="למשל: אדם 1"></div>
      <div class="form-group"><label>ברירת מחדל לכרטיסים</label><select id="ccAccount"><option ${existing?.defaultAccount!=='ביתי'?'selected':''}>עסקי</option><option ${existing?.defaultAccount==='ביתי'?'selected':''}>ביתי</option></select></div>
      <div class="form-group cc-field cc-username"><label>שם משתמש</label><input id="ccUsername" autocomplete="username" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-id"><label>תעודת זהות</label><input id="ccId" inputmode="numeric" autocomplete="username" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-card6"><label>6 ספרות אחרונות של כרטיס</label><input id="ccCard6" inputmode="numeric" maxlength="6" autocomplete="cc-number" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-password"><label>סיסמה</label><input id="ccPassword" type="password" autocomplete="current-password" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group full"><div class="notice">פרטי ההתחברות נשלחים רק ל‑Bridge המקומי ונשמרים מוצפנים ב‑Windows. הם אינם נשמרים בקופה או ב‑Supabase. יש להגדיר חיבור אחד בלבד לכל זהות כניסה בכל חברה; חיבור יחיד מגלה את כל הכרטיסים שהזהות מורשית לראות. אפשר להגדיר חיבור נוסף לאותה חברה רק לבעל חשבון אחר עם זהות כניסה שונה.</div></div>
      <div class="form-group full"><div class="notice">כרטיס Mastercard מחברים לפי החברה המנפיקה שלו — כאל, MAX, ישראכרט או American Express — ולא כחיבור נפרד. כרטיס American Express יש לבחור כחיבור American Express נפרד, גם אם ניהולו בקבוצת ישראכרט.</div></div><div class="form-group full cc-isracard-note" hidden><div class="notice">ישראכרט/American Express: החיבור משתמש בתעודת זהות + 6 ספרות אחרונות + הסיסמה הקבועה דרך שירותי האתר. החל מ‑Bank Bridge v15, American Express רץ במנוע Camoufox ייעודי בגלל חסימת הדפדפן האוטומטי הרגיל; ישראכרט עובר אליו רק אם החיבור הרגיל מחזיר חסימת אוטומציה/HTML. בישראכרט חלון אבחון יכול להישאר זמן ממושך על מסך הכניסה בזמן איסוף חודשים רבים ובהשהיות מכוונות — זה אינו בהכרח תקלה.</div></div>
    </form>`;
    modal(isEdit?'עריכת חיבור אשראי':'חיבור חדש לחברת אשראי',body,isEdit?'שמור חיבור':'הוסף חיבור',async()=>{
      if(!current())return false;
      const payload=readCreditConnectionInput(existing?.profileId||uid('CCP'),field=>document.getElementById(field).value);
      const saved=await saveConnection(payload);
      if(saved===true&&current())closeModal();
      return saved;
    });
    const select=document.getElementById('ccProvider');form=document.getElementById('creditConnectionForm');
    const update=()=>{if(!current())return;const fields=new Set(providerFields(select.value));document.querySelector('.cc-username').hidden=!fields.has('username');document.querySelector('.cc-id').hidden=!fields.has('id');document.querySelector('.cc-card6').hidden=!fields.has('card6Digits');const note=document.querySelector('.cc-isracard-note');if(note)note.hidden=!(select.value==='isracard'||select.value==='amex')};
    resources.listen(select,'change',update);
    if(form)resources.listen(form,'submit',event=>{event.preventDefault();if(current())document.querySelector('[data-modal-save]')?.click()});
    update();armModalDraftGuard();
  }

  return {open:openCreditConnectionModal,dispose:()=>{generation++;resources?.dispose();resources=null}};
}
