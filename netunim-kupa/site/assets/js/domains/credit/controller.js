import {esc,uid} from '../../core/values.js';
import {creditCardMappingKey,creditSyncHasData,creditSyncHasIncludedCards,mergeCreditSyncResult,normalizeCreditSync,CREDIT_PROVIDER_LABELS} from './sync-feed.js';

const CREDIT_AUTO_KEY='netunim_kupa_credit_auto_daily_v1';
const CREDIT_AUTO_ATTEMPT_KEY='netunim_kupa_credit_auto_attempt_v1';
const CREDIT_AUTO_INTERVAL_MS=24*60*60*1000;
const CREDIT_AUTO_RETRY_MS=60*60*1000;

function due(value,now=Date.now()){const t=value?Date.parse(value):NaN;return !Number.isFinite(t)||now-t>=CREDIT_AUTO_INTERVAL_MS}
function providerFields(provider){return provider==='isracard'||provider==='amex'?['id','card6Digits','password']:['username','password']}

export function createDomainsCreditController({model,saveState,toast,render,bridge,modal,armModalDraftGuard,closeModal,confirmDialog}){
  const local={busy:false,status:null,error:'',autoTimer:null};
  function autoEnabled(){return localStorage.getItem(CREDIT_AUTO_KEY)==='1'}
  function markAutoAttempt(){localStorage.setItem(CREDIT_AUTO_ATTEMPT_KEY,String(Date.now()))}
  function autoAttemptReady(){const n=Number(localStorage.getItem(CREDIT_AUTO_ATTEMPT_KEY)||0);return !n||Date.now()-n>=CREDIT_AUTO_RETRY_MS}
  function creditSyncUiState(){return {...local,autoEnabled:autoEnabled(),sync:normalizeCreditSync(model.state.creditSync)}}

  async function refreshCreditBridgeStatus({quiet=true}={}){
    try{
      const status=await bridge.creditStatus();
      local.status=status;local.error='';
      if(Number(status.bridgeVersion||0)<12)local.error='Bank Bridge ישן. יש להריץ שוב install_bank_bridge.bat במחשב זה.';
      if(!quiet&&model.state.creditSync?.mode==='synced')render();
      return status;
    }catch(e){local.status=null;local.error=e?.message||String(e);if(!quiet)render();return null}
  }

  function profileFromState(profileId){return normalizeCreditSync(model.state.creditSync).profiles.find(p=>p.profileId===profileId)||null}
  function profileFromBridge(profileId){return (local.status?.profiles||[]).find(p=>p.profileId===profileId)||null}

  function openCreditConnectionModal(profileId=''){
    const cloud=profileFromState(profileId),localProfile=profileFromBridge(profileId),existing=localProfile||cloud;
    const provider=existing?.provider||'visaCal',isEdit=!!existing,canPreserveCredentials=!!localProfile;
    const body=`<form id="creditConnectionForm" class="form-grid credit-connect-grid" autocomplete="off">
      <div class="form-group"><label>חברה</label><select id="ccProvider"><option value="visaCal" ${provider==='visaCal'?'selected':''}>כאל</option><option value="max" ${provider==='max'?'selected':''}>MAX</option><option value="isracard" ${provider==='isracard'?'selected':''}>ישראכרט</option><option value="amex" ${provider==='amex'?'selected':''}>American Express</option></select></div>
      <div class="form-group"><label>שם החיבור</label><input id="ccLabel" value="${esc(existing?.label||CREDIT_PROVIDER_LABELS[provider]||'')}" placeholder="למשל: MAX - אדם 1"></div>
      <div class="form-group"><label>בעל החשבון</label><input id="ccOwner" value="${esc(existing?.ownerLabel||'')}" placeholder="למשל: אדם 1"></div>
      <div class="form-group"><label>ברירת מחדל לכרטיסים</label><select id="ccAccount"><option ${existing?.defaultAccount!=='ביתי'?'selected':''}>עסקי</option><option ${existing?.defaultAccount==='ביתי'?'selected':''}>ביתי</option></select></div>
      <div class="form-group cc-field cc-username"><label>שם משתמש</label><input id="ccUsername" autocomplete="username" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-id"><label>תעודת זהות</label><input id="ccId" inputmode="numeric" autocomplete="username" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-card6"><label>6 ספרות אחרונות של כרטיס</label><input id="ccCard6" inputmode="numeric" maxlength="6" autocomplete="cc-number" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group cc-field cc-password"><label>סיסמה</label><input id="ccPassword" type="password" autocomplete="current-password" placeholder="${canPreserveCredentials?'השאר ריק כדי לא לשנות':''}"></div>
      <div class="form-group full"><div class="notice">פרטי ההתחברות נשלחים רק ל‑Bridge המקומי ונשמרים מוצפנים ב‑Windows. הם אינם נשמרים בקופה או ב‑Supabase. אפשר להגדיר כמה חיבורים לאותה חברה, גם לשני אנשים שונים.</div></div>
      <div class="form-group full"><div class="notice">כרטיס Mastercard מחברים לפי החברה המנפיקה שלו — כאל, MAX, ישראכרט או American Express — ולא כחיבור נפרד. כרטיס American Express יש לבחור כחיבור American Express נפרד, גם אם ניהולו בקבוצת ישראכרט.</div></div><div class="form-group full cc-isracard-note" hidden><div class="notice">ישראכרט/American Express: החיבור משתמש בתעודת זהות + 6 ספרות אחרונות + הסיסמה הקבועה. ברענון עם חלון, הדף עשוי להישאר חזותית על מסך SMS מפני שה־scraper מבצע את מסלול הסיסמה הקבועה דרך שירותי האתר ברקע; מצב הסנכרון בקופה הוא מקור האמת להצלחה או לכשל.</div></div>
    </form>`;
    modal(isEdit?'עריכת חיבור אשראי':'חיבור חדש לחברת אשראי',body,isEdit?'שמור חיבור':'הוסף חיבור',async()=>{
      const selectedProvider=document.getElementById('ccProvider').value;
      const payload={profileId:existing?.profileId||uid('CCP'),provider:selectedProvider,label:document.getElementById('ccLabel').value.trim(),ownerLabel:document.getElementById('ccOwner').value.trim(),defaultAccount:document.getElementById('ccAccount').value,username:document.getElementById('ccUsername').value,id:document.getElementById('ccId').value,card6Digits:document.getElementById('ccCard6').value,password:document.getElementById('ccPassword').value};
      try{await bridge.saveCreditProfile(payload);closeModal(true);await refreshCreditBridgeStatus();toast('חיבור האשראי נשמר במחשב');render()}
      catch(e){toast(e?.message||'שמירת חיבור האשראי נכשלה')}
    });
    const select=document.getElementById('ccProvider'),form=document.getElementById('creditConnectionForm');
    const update=()=>{const fields=new Set(providerFields(select.value));document.querySelector('.cc-username').hidden=!fields.has('username');document.querySelector('.cc-id').hidden=!fields.has('id');document.querySelector('.cc-card6').hidden=!fields.has('card6Digits');const note=document.querySelector('.cc-isracard-note');if(note)note.hidden=!(select.value==='isracard'||select.value==='amex')};
    select.addEventListener('change',update);
    form?.addEventListener('submit',event=>{event.preventDefault();document.querySelector('[data-modal-save]')?.click()});
    update();armModalDraftGuard();
  }

  async function deleteCreditConnection(profileId){
    if(!await confirmDialog('למחוק חיבור מהמחשב?','פרטי ההתחברות המוצפנים של החיבור יימחקו מהמחשב הזה. נתוני הסנכרון שכבר נשמרו בקופה לא יימחקו.',{confirmText:'מחק חיבור'}))return;
    try{await bridge.deleteCreditProfile(profileId);await refreshCreditBridgeStatus();toast('החיבור המקומי נמחק');render()}catch(e){toast(e?.message||'מחיקת החיבור נכשלה')}
  }

  async function refreshCreditSync({interactive=false,auto=false}={}){
    if(local.busy)return;
    local.busy=true;local.error='';if(!auto)render();
    try{
      const status=local.status||await refreshCreditBridgeStatus();
      if(!status)throw new Error(local.error||'Bank Bridge אינו זמין');
      if(Number(status.bridgeVersion||0)<12)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון אשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      if(auto)markAutoAttempt();
      const result=await bridge.syncCreditCards({interactive});
      model.state.creditSync=mergeCreditSyncResult(model.state.creditSync,result);
      await saveState(result.errors?.length?'האשראי עודכן חלקית':'האשראי עודכן מחברות האשראי');
      await refreshCreditBridgeStatus();
      if(!auto)toast(result.errors?.length?`הסנכרון הושלם עם ${result.errors.length} אזהרות`:'נתוני האשראי עודכנו');
    }catch(e){
      local.error=e?.message||String(e);
      // If every local profile failed, the Bridge returns HTTP 400 with structured per-profile errors.
      // Persist those diagnostics without deleting the last successful profile data.
      if(Array.isArray(e?.creditErrors)&&e.creditErrors.length){
        model.state.creditSync=mergeCreditSyncResult(model.state.creditSync,{profiles:[],errors:e.creditErrors});
        await saveState('סנכרון האשראי נכשל — הנתונים המוצלחים הקודמים נשמרו');
      }
      if(!auto)toast(local.error)
    }
    finally{local.busy=false;render();scheduleAuto()}
  }

  async function setCreditSyncMode(mode){
    const next=mode==='synced'?'synced':'manual';
    if(next==='synced'&&!creditSyncHasData(model.state))return toast('אין עדיין נתוני אשראי מסונכרנים. בצע רענון ראשון לפני המעבר.');
    if(next==='synced'&&!creditSyncHasIncludedCards(model.state))return toast('יש לבחור לפחות כרטיס אחד ב״שיוך כרטיסים״ לפני מעבר לנתונים המסונכרנים.');
    model.state.creditSync=normalizeCreditSync({...model.state.creditSync,mode:next});
    await saveState(next==='synced'?'מקור תחזית האשראי הוחלף לנתונים מסונכרנים':'מקור תחזית האשראי הוחזר להזנה ידנית');render();
  }

  async function setCreditCardMapping(profileId,accountNumber,field,value){
    const sync=normalizeCreditSync(model.state.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:''};
    if(field==='included')current.included=!!value;
    if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';
    if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);
    sync.cardMappings[key]=current;model.state.creditSync=sync;await saveState('שיוך כרטיס האשראי עודכן');render();
  }

  function setCreditAutoRefresh(enabled){localStorage.setItem(CREDIT_AUTO_KEY,enabled?'1':'0');scheduleAuto();render()}
  function scheduleAuto(){
    if(local.autoTimer){clearTimeout(local.autoTimer);local.autoTimer=null}
    if(!autoEnabled())return;
    const syncedAt=model.state.creditSync?.syncedAt,t=syncedAt?Date.parse(syncedAt):NaN;
    const wait=Number.isFinite(t)?Math.max(0,t+CREDIT_AUTO_INTERVAL_MS-Date.now()):0;
    local.autoTimer=setTimeout(()=>{local.autoTimer=null;maybeAutoRefreshCreditSync()},Math.max(1000,wait+250));
  }
  async function maybeAutoRefreshCreditSync(){
    scheduleAuto();if(!autoEnabled()||local.busy||!due(model.state.creditSync?.syncedAt)||!autoAttemptReady())return;
    const status=local.status||await refreshCreditBridgeStatus();if(!(status?.profiles||[]).length)return;
    refreshCreditSync({interactive:false,auto:true}).catch(()=>{});
  }

  return {creditSyncUiState,refreshCreditBridgeStatus,openCreditConnectionModal,deleteCreditConnection,refreshCreditSync,setCreditSyncMode,setCreditCardMapping,setCreditAutoRefresh,maybeAutoRefreshCreditSync};
}
