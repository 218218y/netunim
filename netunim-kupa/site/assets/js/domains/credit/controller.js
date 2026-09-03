import {esc,uid} from '../../core/values.js';
import {creditCardMappingKey,mergeCreditSyncResult,normalizeCreditSync,CREDIT_PROVIDER_LABELS,CREDIT_CONNECTOR_CONTRACT_VERSION} from './sync-feed.js';

const CREDIT_AUTO_KEY='netunim_kupa_credit_auto_daily_v1';
const CREDIT_BRIDGE_VERSION=29;
const CREDIT_AUTO_ATTEMPT_KEY='netunim_kupa_credit_auto_attempt_v1';
const CREDIT_AUTO_INTERVAL_MS=24*60*60*1000;
const CREDIT_AUTO_RETRY_MS=24*60*60*1000;

function due(value,now=Date.now()){const t=value?Date.parse(value):NaN;return !Number.isFinite(t)||now-t>=CREDIT_AUTO_INTERVAL_MS}
function supportedCreditBridge(status){const version=Number(status?.bridgeVersion||0),contract=Number(status?.contractVersion||0);return version>=CREDIT_BRIDGE_VERSION&&contract>=CREDIT_CONNECTOR_CONTRACT_VERSION||version===28&&contract===2||version===27&&contract===0}
function providerFields(provider){return provider==='isracard'||provider==='amex'?['id','card6Digits','password']:['username','password']}

export function createDomainsCreditController({model,saveState,toast,render,bridge,modal,armModalDraftGuard,closeModal,confirmDialog,refreshFinanceCloudSnapshot=async()=>({verified:true,state:model.state}),saveFinancePatch=async()=>({saved:false}),claimFinanceSyncLease=async()=>({acquired:true}),releaseFinanceSyncLease=async()=>true}){
  const local={busy:false,status:null,error:'',errorAt:null,bridgeError:'',bridgeErrorAt:null,autoTimer:null};
  function autoEnabled(){return localStorage.getItem(CREDIT_AUTO_KEY)!=='0'}
  function markAutoAttempt(){localStorage.setItem(CREDIT_AUTO_ATTEMPT_KEY,String(Date.now()))}
  function autoAttemptDelayMs(){const n=Number(localStorage.getItem(CREDIT_AUTO_ATTEMPT_KEY)||0);return n?Math.max(0,n+CREDIT_AUTO_RETRY_MS-Date.now()):0}
  function autoAttemptReady(){return autoAttemptDelayMs()===0}
  function creditSyncUiState(){return {...local,autoEnabled:autoEnabled(),sync:normalizeCreditSync(model.state.creditSync)}}
  async function copySafeCreditDiagnostics(){
    try{const result=await bridge.creditDiagnostics(),events=Array.isArray(result?.events)?result.events:[],content=JSON.stringify({contractVersion:result?.contractVersion||CREDIT_CONNECTOR_CONTRACT_VERSION,events},null,2);if(!navigator?.clipboard?.writeText)throw new Error('הדפדפן אינו מאפשר העתקה מאובטחת ללוח');await navigator.clipboard.writeText(content);toast(`הועתק אבחון טכני בטוח (${events.length} אירועים מסוננים)`);return true}catch(error){toast(error?.message||'העתקת האבחון נכשלה');return false}
  }

  async function refreshCreditBridgeStatus({quiet=true}={}){
    try{
      const status=await bridge.creditStatus();
      local.status=status;local.bridgeError='';local.bridgeErrorAt=null;
      if(!supportedCreditBridge(status)){local.bridgeError='Bank Bridge ישן. יש להריץ שוב install_bank_bridge.bat במחשב זה.';local.bridgeErrorAt=new Date().toISOString()}
      if(!quiet)render();
      return status;
    }catch(e){local.status=null;local.bridgeError=e?.message||String(e);local.bridgeErrorAt=new Date().toISOString();if(!quiet)render();return null}
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
      <div class="form-group full"><div class="notice">פרטי ההתחברות נשלחים רק ל‑Bridge המקומי ונשמרים מוצפנים ב‑Windows. הם אינם נשמרים בקופה או ב‑Supabase. יש להגדיר חיבור אחד בלבד לכל זהות כניסה בכל חברה; חיבור יחיד מגלה את כל הכרטיסים שהזהות מורשית לראות. אפשר להגדיר חיבור נוסף לאותה חברה רק לבעל חשבון אחר עם זהות כניסה שונה.</div></div>
      <div class="form-group full"><div class="notice">כרטיס Mastercard מחברים לפי החברה המנפיקה שלו — כאל, MAX, ישראכרט או American Express — ולא כחיבור נפרד. כרטיס American Express יש לבחור כחיבור American Express נפרד, גם אם ניהולו בקבוצת ישראכרט.</div></div><div class="form-group full cc-isracard-note" hidden><div class="notice">ישראכרט/American Express: החיבור משתמש בתעודת זהות + 6 ספרות אחרונות + הסיסמה הקבועה דרך שירותי האתר. החל מ‑Bank Bridge v15, American Express רץ במנוע Camoufox ייעודי בגלל חסימת הדפדפן האוטומטי הרגיל; ישראכרט עובר אליו רק אם החיבור הרגיל מחזיר חסימת אוטומציה/HTML. בישראכרט חלון אבחון יכול להישאר זמן ממושך על מסך הכניסה בזמן איסוף חודשים רבים ובהשהיות מכוונות — זה אינו בהכרח תקלה.</div></div>
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
    if(!await confirmDialog('למחוק חיבור מהמחשב?','פרטי ההתחברות המוצפנים של החיבור יימחקו מהמחשב הזה. נתוני הסנכרון שכבר נשמרו בקופה/בענן לא יימחקו ולכן החיבור עדיין עשוי להופיע כ״הגדר גם במחשב זה״. למחיקה מלאה והתחלה מחדש השתמש ב״איפוס מלא״.',{confirmText:'מחק חיבור'}))return;
    try{await bridge.deleteCreditProfile(profileId);await refreshCreditBridgeStatus();toast('החיבור המקומי נמחק');render()}catch(e){toast(e?.message||'מחיקת החיבור נכשלה')}
  }


  async function resetCreditSync(){
    if(local.busy)return toast('כבר מתבצע סנכרון אשראי');
    if(!await confirmDialog('לאפס את כל סנכרון האשראי?','האיפוס ימחק את כל חיבורי חברות האשראי המוצפנים מהמחשב הזה וגם את נתוני הסנכרון, השיוכים והשגיאות השמורים בקופה/בענן. תוספות ידניות חדשות שנוצרו לאחר המעבר לסנכרון יישארו, משום שהן שכבה משלימה ולא מקור חלופי.',{confirmText:'אפס והתחל מחדש'}))return;
    local.busy=true;local.error='';local.errorAt=null;render();
    try{
      const status=local.status||await refreshCreditBridgeStatus();
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');
      await bridge.resetCreditProfiles();
      localStorage.setItem(CREDIT_AUTO_KEY,'0');localStorage.removeItem(CREDIT_AUTO_ATTEMPT_KEY);
      model.state.creditSync=normalizeCreditSync({});
      await saveFinancePatch(state=>({...state,creditSync:model.state.creditSync}));
      await saveState('סנכרון האשראי אופס והופרד מגיבויי הקופה');
      await refreshCreditBridgeStatus();
      toast('סנכרון האשראי אופס. אפשר להגדיר מחדש חיבור אחד לכל בעל חשבון וחברה.');
    }catch(e){local.error=e?.message||String(e);local.errorAt=new Date().toISOString();toast(local.error)}
    finally{local.busy=false;render();scheduleAuto()}
  }

  async function refreshCreditSync({interactive=false,auto=false}={}){
    if(local.busy)return;
    local.busy=true;local.error='';local.errorAt=null;if(!auto)render();
    let leaseToken='',leaseHeld=false;
    try{
      if(auto){
        const latest=await refreshFinanceCloudSnapshot();
        if(!latest?.verified){markAutoAttempt();throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');}
        if(!due(latest.state?.creditSync?.syncedAt)){markAutoAttempt();return true}
        markAutoAttempt();
      }
      leaseToken=uid('FINLEASE');
      const lease=await claimFinanceSyncLease('credit',leaseToken);leaseHeld=lease?.acquired===true;
      if(!leaseHeld){if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');return false}
      if(auto){const latest=await refreshFinanceCloudSnapshot();if(!latest?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה');if(!due(latest.state?.creditSync?.syncedAt))return true}
      const status=local.status||await refreshCreditBridgeStatus();
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון אשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const result=await bridge.syncCreditCards({interactive});
      if(Number(result.attemptedCount)===0&&Number(result.deferredCount)>0){await refreshCreditBridgeStatus();local.error='';local.errorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');return true}
      model.state.creditSync=mergeCreditSyncResult(model.state.creditSync,result);
      await saveFinancePatch(state=>({...state,creditSync:model.state.creditSync}));
      const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);
      await saveState(deferredOnly?'סנכרון האשראי הושהה ו־Last Known Good נשמר':result.errors?.length?'האשראי עודכן עם אזהרות ונשמר מחוץ לגיבויי הקופה':'האשראי עודכן ונשמר מחוץ לגיבויי הקופה');
      await refreshCreditBridgeStatus();
      if(!auto)toast(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`הסנכרון הושלם עם ${result.errors.length} אזהרות`:'נתוני האשראי עודכנו');
    }catch(e){
      const deferredOnly=Array.isArray(e?.creditErrors)&&e.creditErrors.length>0&&e.creditErrors.every(error=>error?.severity==='deferred'||error?.deferred===true);local.error=deferredOnly?'':e?.message||String(e);local.errorAt=deferredOnly?null:new Date().toISOString();
      // If every local profile failed, the Bridge returns HTTP 400 with structured per-profile errors.
      // Persist those diagnostics without deleting the last successful profile data.
      if(Array.isArray(e?.creditErrors)&&e.creditErrors.length){
        model.state.creditSync=mergeCreditSyncResult(model.state.creditSync,{profiles:[],errors:e.creditErrors});
        await saveFinancePatch(state=>({...state,creditSync:model.state.creditSync}));
      }
      if(!auto)toast(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':local.error)
    }
    finally{if(leaseHeld)try{await releaseFinanceSyncLease('credit',leaseToken)}catch(error){console.error('credit sync lease release',error)}local.busy=false;render();scheduleAuto()}
  }

  async function setCreditCardMapping(profileId,accountNumber,field,value){
    const sync=normalizeCreditSync(model.state.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};
    if(field==='included')current.included=!!value;
    if(field==='hidden')current.hidden=!!value;
    if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';
    if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);
    if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0)){toast('מסגרת ידנית חייבת להיות מספר חיובי או אפס');return false}current.manualFrame=amount===null?null:Math.round(amount*100)/100}
    sync.cardMappings[key]=current;model.state.creditSync=sync;await saveFinancePatch(state=>({...state,creditSync:sync}));await saveState('שיוך כרטיס האשראי עודכן');render();
  }

  function setCreditAutoRefresh(enabled){localStorage.setItem(CREDIT_AUTO_KEY,enabled?'1':'0');scheduleAuto();render()}
  function scheduleAuto(){
    if(local.autoTimer){clearTimeout(local.autoTimer);local.autoTimer=null}
    if(!autoEnabled())return;
    const syncedAt=model.state.creditSync?.syncedAt,t=syncedAt?Date.parse(syncedAt):NaN;
    const wait=Number.isFinite(t)?Math.max(0,t+CREDIT_AUTO_INTERVAL_MS-Date.now()):0,retryWait=autoAttemptDelayMs();
    local.autoTimer=setTimeout(()=>{local.autoTimer=null;maybeAutoRefreshCreditSync()},Math.max(1000,wait+250,retryWait+250));
  }
  async function maybeAutoRefreshCreditSync(){
    scheduleAuto();if(!autoEnabled()||local.busy||!due(model.state.creditSync?.syncedAt)||!autoAttemptReady())return;
    const status=local.status||await refreshCreditBridgeStatus();if(!(status?.profiles||[]).length)return;
    refreshCreditSync({interactive:false,auto:true}).catch(()=>{});
  }

  return {creditSyncUiState,refreshCreditBridgeStatus,copySafeCreditDiagnostics,openCreditConnectionModal,deleteCreditConnection,resetCreditSync,refreshCreditSync,setCreditCardMapping,setCreditAutoRefresh,maybeAutoRefreshCreditSync};
}
