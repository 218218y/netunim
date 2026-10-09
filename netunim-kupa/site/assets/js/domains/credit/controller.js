import {CREDIT_AUTO_INTERVAL_MS,creditRefreshDue as due} from '../../shared/finance-refresh-policy.js';
import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {startFinanceLeaseHeartbeat} from '../../shared/finance-fence.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {createCreditPublication} from './publication.js';
import {normalizeCreditAutoMode,normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../../shared/credit-sync-policy.js';
import {esc,uid} from '../../core/values.js';
import {creditCardMappingKey,creditSyncScrapeSelection,mergeCreditSyncResult,normalizeCreditSync,CREDIT_PROVIDER_LABELS,CREDIT_CONNECTOR_CONTRACT_VERSION} from './sync-feed.js';

const CREDIT_BRIDGE_VERSION=73;
const CREDIT_AUTO_RETRY_MS=24*60*60*1000;

function supportedCreditBridge(status){const version=Number(status?.bridgeVersion||0),contract=Number(status?.contractVersion||0);return version>=CREDIT_BRIDGE_VERSION&&contract>=CREDIT_CONNECTOR_CONTRACT_VERSION}
function providerFields(provider){return provider==='isracard'||provider==='amex'?['id','card6Digits','password']:['username','password']}

export function createDomainsCreditController({model,saveState,toast,render,renderStatus=render,bridge,preferences,modal,armModalDraftGuard,closeModal,confirmDialog,autoScope,captureOperation,timers=globalThis,refreshFinanceCloudSnapshot=async()=>({verified:true,state:model.state}),saveFinancePatch=async()=>({saved:false}),claimFinanceSyncLease=async()=>({acquired:true}),releaseFinanceSyncLease=async()=>true}){
  if(typeof autoScope!=='function')throw new Error('credit_auto_scope_required');
  if(typeof captureOperation!=='function')throw new Error('credit_operation_scope_required');
  if(!preferences||!['read','setEnabled','setMode','markAttempt','reset'].every(key=>typeof preferences[key]==='function'))throw new Error('credit_preferences_port_required');
  const local={busy:false,status:null,error:'',errorAt:null,bridgeError:'',bridgeErrorAt:null,autoTimer:null,preferenceWarning:'',preferenceWarningCode:''};
  const publication=createCreditPublication({commit:saveFinancePatch,read:refreshFinanceCloudSnapshot,publish:state=>{model.state.creditSync=normalizeCreditSync(state.creditSync)},checkpoint:message=>saveState(message,{operations:[{type:'set',field:'creditSync',value:model.state.creditSync}]})});
  let automaticActive=true,automaticOwner=null,preferencesPaused=false;
  const automaticAllowed=()=>{
    const scope=autoScope();if(!automaticActive||typeof scope!=='string'||!scope.length)return false;
    if(automaticOwner===null)automaticOwner=scope;
    return scope===automaticOwner&&autoEnabled()&&!!bridge.getBridgeToken();
  };
  const autoTask=createPollingTask({timers,canRun:automaticAllowed,delay:autoDelay,run:runAutomaticCredit,onError:error=>console.error('credit auto refresh',error),onState:({timer})=>{local.autoTimer=timer}});
  function preferenceResult(result){
    if(result.ok)return true;
    const changed=!preferencesPaused||local.preferenceWarningCode!==result.error.code;
    preferencesPaused=true;autoTask.stop();
    local.preferenceWarningCode=result.error.code;
    local.preferenceWarning='לא ניתן לקרוא או לשמור את העדפות האשראי במחשב זה. העדכון האוטומטי הושהה בחלון זה; ניתן לרענן ידנית. לאחר תיקון האחסון הפעל מחדש עדכון אוטומטי. ההשהיה לא נשמרה בהכרח לפתיחה הבאה.';
    // A background gate may stop before entering the task's finally/render.
    // Publish the transition once; repeated reads during rendering stay quiet.
    if(changed)renderStatus();
    return false;
  }
  function readPreferences(){const result=preferences.read();return preferenceResult(result)?result.value:null}
  function clearPreferenceFailure(){preferencesPaused=false;local.preferenceWarning='';local.preferenceWarningCode=''}
  function autoEnabled(){const settings=readPreferences();return !preferencesPaused&&settings?.enabled===true}
  function autoMode(){return normalizeCreditAutoMode(readPreferences()?.mode)}
  function markAutoAttempt(){return preferenceResult(preferences.markAttempt())}
  function autoAttemptDelayMs(){const settings=readPreferences();if(!settings)return Infinity;const n=settings.attemptAt;return n?Math.max(0,n+CREDIT_AUTO_RETRY_MS-Date.now()):0}
  function autoAttemptReady(){return autoAttemptDelayMs()===0}
  function creditSyncUiState(){const settings=readPreferences();return {...local,...publication.status(),autoEnabled:!preferencesPaused&&settings?.enabled===true,autoMode:normalizeCreditAutoMode(settings?.mode),sync:normalizeCreditSync(model.state.creditSync)}}
  async function copySafeCreditDiagnostics(){
    try{const result=await bridge.creditDiagnostics(),events=Array.isArray(result?.events)?result.events:[],content=JSON.stringify({contractVersion:result?.contractVersion||CREDIT_CONNECTOR_CONTRACT_VERSION,events},null,2);if(!navigator?.clipboard?.writeText)throw new Error('הדפדפן אינו מאפשר העתקה מאובטחת ללוח');await navigator.clipboard.writeText(content);toast(`הועתק אבחון טכני בטוח (${events.length} אירועים מסוננים)`);return true}catch(error){toast(error?.message||'העתקת האבחון נכשלה');return false}
  }
  function downloadCreditDataDiagnosticJson(filename,data){
    const safeName=/^[A-Za-z0-9._-]+$/.test(String(filename||''))?String(filename):'netunim-credit-data-diagnostics.json';
    const blob=new Blob([JSON.stringify(data??{},null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=safeName;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},1000);
  }
  async function exportCreditDataDiagnostics(){
    if(local.busy)return false;
    if(!bridge.getBridgeToken()){toast('יש לצמד את הקופה ל-Bank Bridge לפני ייצוא אבחון אשראי');return false}
    if(local.status&&!supportedCreditBridge(local.status)){toast('יש להריץ מחדש install_bank_bridge.bat לפני ייצוא אבחון נתוני אשראי');return false}
    try{const result=await bridge.creditDataDiagnostics();if(!result?.available||!result?.data)throw new Error(result?.message||'עדיין אין אבחון נתוני אשראי מקומי. בצע רענון אשראי ולאחריו נסה שוב.');downloadCreditDataDiagnosticJson(result.filename,result.data);toast(`קובץ אבחון אשראי JSON נוצר מהסנכרון האחרון (${Number(result.cardCount)||0} כרטיסים)`);return true}catch(error){toast(error?.message||'ייצוא אבחון האשראי נכשל');return false}
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
    let assertCurrent;
    try{assertCurrent=captureOperation()}catch(error){toast(error.message);return false}
    if(!await confirmDialog('לאפס את כל סנכרון האשראי?','האיפוס ימחק את כל חיבורי חברות האשראי המוצפנים מהמחשב הזה וגם את נתוני הסנכרון, השיוכים והשגיאות השמורים בקופה/בענן. תוספות ידניות חדשות שנוצרו לאחר המעבר לסנכרון יישארו, משום שהן שכבה משלימה ולא מקור חלופי.',{confirmText:'אפס והתחל מחדש'}))return;
    local.busy=true;local.error='';local.errorAt=null;render();
    try{
      assertCurrent();
      const status=local.status||await refreshCreditBridgeStatus();
      assertCurrent();
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');
      await bridge.resetCreditProfiles();
      assertCurrent();
      automaticActive=false;autoTask.stop();if(preferenceResult(preferences.reset()))clearPreferenceFailure();
      await publishCreditSync(normalizeCreditSync({}),'סנכרון האשראי אופס והופרד מגיבויי הקופה',null,assertCurrent);
      await refreshCreditBridgeStatus();
      assertCurrent();
      toast(publication.status().publicationWarning||'סנכרון האשראי אופס. אפשר להגדיר מחדש חיבור אחד לכל בעל חשבון וחברה.');
      if(local.preferenceWarning)toast(local.preferenceWarning);
    }catch(e){local.error=e?.message||String(e);local.errorAt=new Date().toISOString();toast(local.error)}
    finally{local.busy=false;render();scheduleAuto()}
  }

  async function refreshCreditSync({interactive=false,auto=false,syncMode='forecast',isCurrent=()=>true}={}){
    const scope=auto?autoScope():null,allowed=()=>isCurrent()&&automaticAllowed()&&autoScope()===scope;
    if(auto&&!allowed())return false;
    if(local.busy)return;
    local.busy=true;local.error='';local.errorAt=null;if(auto)renderStatus();else render();
    let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,autoCreditSync=model.state.creditSync,assertCurrent;
    try{
      const assertOwner=captureOperation();assertCurrent=()=>{assertOwner();heartbeat?.assertCurrent()};
      if(auto){
        const latest=await refreshFinanceCloudSnapshot();
        assertCurrent();
        if(!allowed())return false;
        if(!latest?.verified){if(!markAutoAttempt())return false;throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');}
        autoCreditSync=latest.state?.creditSync||autoCreditSync;
        if(!due(autoCreditSync?.syncedAt))return markAutoAttempt();
        if(!markAutoAttempt())return false;
      }
      leaseToken=uid('FINLEASE');
      lease=await claimFinanceSyncLease('credit',leaseToken,{assertCurrent});leaseHeld=lease?.acquired===true;
      assertCurrent();lease={...lease,assertCurrent};
      if(auto&&!allowed())return false;
      if(!leaseHeld){if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');return false}
      heartbeat=startFinanceLeaseHeartbeat(lease,claimFinanceSyncLease);
      if(auto){const latest=await refreshFinanceCloudSnapshot();assertCurrent();if(!allowed())return false;if(!latest?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה');autoCreditSync=latest.state?.creditSync||autoCreditSync;if(!due(autoCreditSync?.syncedAt))return true}
      const status=local.status||await refreshCreditBridgeStatus();
      assertCurrent();
      if(auto&&!allowed())return false;
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון אשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const requestedMode=auto?resolveCreditAutoSyncMode(autoMode(),autoCreditSync,{profileIds:(status.profiles||[]).map(profile=>profile.profileId)}):normalizeCreditFetchMode(syncMode,'forecast');
      const selectionSource=auto?autoCreditSync:model.state.creditSync;
      if(auto&&!allowed())return false;
      const result=await bridge.syncCreditCards({interactive,syncMode:requestedMode,selection:creditSyncScrapeSelection(selectionSource)});
      assertCurrent();
      if(Number(result.attemptedCount)===0&&Number(result.deferredCount)>0){await refreshCreditBridgeStatus();assertCurrent();local.error='';local.errorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');return true}
      const candidate=mergeCreditSyncResult(model.state.creditSync,result);
      const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);
      await publishCreditSync(candidate,deferredOnly?'סנכרון האשראי הושהה ו־Last Known Good נשמר':result.errors?.length?'האשראי עודכן עם אזהרות ונשמר מחוץ לגיבויי הקופה':'האשראי עודכן ונשמר מחוץ לגיבויי הקופה',lease,assertCurrent);
      await refreshCreditBridgeStatus();
      assertCurrent();
      if(!auto)toast(publication.status().publicationWarning||(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`הסנכרון הושלם עם ${result.errors.length} אזהרות`:'נתוני האשראי עודכנו'));
    }catch(e){
      try{assertCurrent?.()}catch(scopeError){e=scopeError}
      const deferredOnly=Array.isArray(e?.creditErrors)&&e.creditErrors.length>0&&e.creditErrors.every(error=>error?.severity==='deferred'||error?.deferred===true);local.error=deferredOnly?'':e?.message||String(e);local.errorAt=deferredOnly?null:new Date().toISOString();
      // If every local profile failed, the Bridge returns HTTP 400 with structured per-profile errors.
      // Persist those diagnostics without deleting the last successful profile data.
      if(Array.isArray(e?.creditErrors)&&e.creditErrors.length){
        try{
          const candidate=mergeCreditSyncResult(model.state.creditSync,{profiles:[],errors:e.creditErrors});
          await publishCreditSync(candidate,'אבחון סנכרון האשראי נשמר; הנתונים התקינים הקודמים נשמרו',lease,assertCurrent);
        }catch(error){local.error=error.message||String(error);local.errorAt=new Date().toISOString()}
      }
      if(!auto)toast(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':local.error)
    }
    // A former account's lease expires by TTL; never release it using a new login.
    finally{heartbeat?.stop();if(leaseHeld)try{await releaseFinanceSyncLease('credit',leaseToken,{assertCurrent})}catch(error){if(error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')console.error('credit sync lease release',error)}local.busy=false;render();scheduleAuto()}
  }

  async function publishCreditSync(candidate,message,lease,assertCurrent){
    return publication.commit(state=>({...state,creditSync:candidate}),message,lease,assertCurrent);
  }

  async function persistCreditSettings(mutator,message){
    const assertCurrent=captureOperation();
    await publication.commit(state=>({...state,creditSync:mutator(normalizeCreditSync(state.creditSync))}),message,null,assertCurrent);return true;
  }
  async function retryCreditPublication(){
    if(local.busy)return false;let assertCurrent;try{assertCurrent=captureOperation();assertCurrent()}catch(error){toast(error.message);return false}
    local.busy=true;render();
    try{const confirmed=await publication.retry(assertCurrent);assertCurrent();toast(publication.status().publicationWarning||(confirmed?'נתוני האשראי אומתו בענן והשמירה הנלווית הושלמה.':'לא נמצאה שמירה נלווית הממתינה לבדיקה.'));return confirmed}
    catch(error){toast(error.message||'בדיקת הנתונים בענן נכשלה');return false}
    finally{local.busy=false;render()}
  }
  async function saveCreditCardOrder(keys){return persistCreditSettings(sync=>applyCreditCardOrderData(sync,keys),'סדר הכרטיסים נשמר')}
  async function setCreditCardMapping(profileId,accountNumber,field,value){
    try{
      await persistCreditSettings(normalizedSync=>{
    const sync=normalizedSync,profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};
    if(field==='included')current.included=!!value;
    if(field==='hidden')current.hidden=!!value;
    if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';
    if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);
    if(field==='sortOrder'){const raw=String(value??'').trim(),order=raw===''?null:Number(raw);if(order!==null&&(!Number.isSafeInteger(order)||order<1))throw new Error('סדר הכרטיס חייב להיות מספר שלם חיובי');current.sortOrder=order}
    if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}
        sync.cardMappings[key]=current;return sync;
      },'שיוך כרטיס האשראי עודכן');render();return true;
    }catch(error){toast(error?.message||'שמירת הגדרת הכרטיס נכשלה');render();return false}
  }

  function setCreditAutoRefresh(enabled){
    if(!enabled)autoTask.stop();
    const readable=!enabled||!!readPreferences(),saved=readable&&preferenceResult(preferences.setEnabled(enabled));
    if(saved){clearPreferenceFailure();if(enabled){automaticActive=true;automaticOwner=null;autoTask.start()}}
    else toast(local.preferenceWarning);
    render();return !!saved;
  }
  function setCreditAutoMode(mode){const saved=preferenceResult(preferences.setMode(normalizeCreditAutoMode(mode)));if(saved)scheduleAuto();else toast(local.preferenceWarning);render();return saved}
  function autoDelay(){
    const syncedAt=model.state.creditSync?.syncedAt,t=syncedAt?Date.parse(syncedAt):NaN;
    const wait=Number.isFinite(t)?Math.max(0,t+CREDIT_AUTO_INTERVAL_MS-Date.now()):0,retryWait=autoAttemptDelayMs();
    return Math.max(1000,wait+250,retryWait+250);
  }
  function scheduleAuto(){if(automaticActive)autoTask.start()}
  async function runAutomaticCredit({isCurrent}){
    if(local.busy||!due(model.state.creditSync?.syncedAt)||!autoAttemptReady())return false;
    const scope=autoScope();
    const status=local.status||await refreshCreditBridgeStatus();if(!(status?.profiles||[]).length)return;
    if(!isCurrent()||autoScope()!==scope||!automaticAllowed())return false;
    return refreshCreditSync({interactive:false,auto:true,isCurrent});
  }
  function maybeAutoRefreshCreditSync(){return automaticActive?autoTask.wake():Promise.resolve(false)}
  function startAutoSync(){automaticActive=true;automaticOwner=null;return autoTask.wake()}
  function stopAutoSync(){automaticActive=false;return autoTask.stop()}

  return {creditSyncUiState,refreshCreditBridgeStatus,copySafeCreditDiagnostics,exportCreditDataDiagnostics,openCreditConnectionModal,deleteCreditConnection,resetCreditSync,refreshCreditSync,retryCreditPublication,saveCreditCardOrder,setCreditCardMapping,setCreditAutoRefresh,setCreditAutoMode,maybeAutoRefreshCreditSync,startAutoSync,stopAutoSync};
}
