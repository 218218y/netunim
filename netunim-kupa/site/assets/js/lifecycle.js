import {uid} from './core/values.js';
import {num, money} from './core/money.js';
import {dateFmt, todayISO, localISO, dObj, daysFromToday, monthKey, monthLabel, addMonthsISO, monthKeysBetween, checkDateParts} from './core/dates.js';
import {assertValidCloudState} from './state/validation.js';
import {normalizeSharedBankEvents, normalizeSharedChecks, checkUrgency} from './domains/checks/model.js';
import {rawCreditSchedule, creditSchedule, inactiveCreditExpired, creditProgress} from './domains/credit/model.js';
import {INITIAL_STATE, STORAGE_PREF_KEY} from './state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({hydrateStorageOwner=async()=>{},hydrateStorageTransition=async()=>null,resumeStorageTransition=async()=>null,storageTransitionPreparing=()=>false,hydrateLocalBirth=async()=>null,ensureLocalBirth=async()=>false,localBirthPreparing=()=>false,hydrateStorageV2OwnerTransfer=async()=>null,resumeStorageV2OwnerTransfer=async()=>null,storageV2OwnerTransferPreparing=()=>false,verifyStorageCutover=async()=>false,verifyLocalStorageEngine=async()=>false,recoverLocalV2State=async()=>false,recoverReadOnlyV2State=async()=>false,recoverSharedChecksV2Primary=async()=>false,recoverSharedChecksV2ReadOnly=async()=>false,openBrowserStateFallback=async()=>false,openBrowserStateReadOnly=async()=>false,ensureSyncCapabilities=async()=>true,render=()=>{},model,session, tab, checksSession, prepareKupaCloudState, normalizeState, saveChecksState, syncSharedChecksFromCloud, saveSharedChecksToCloud, pollSharedChecks, openLastFolder, checkDateEditorMarkup, checkDateEditorValue, commitCheckDateEditor, setCheckDateValue, normalizeCheckModalDates, activeChecks, depositedChecks, cashBalance, checksBalance, depositedBalance, pendingInstallments, allInstallments, monthSumInstallments, expenseOccurrencesForMonth, monthSumExpenses, bankBaseBalance, bankAdjustments, bankAdjustmentsTotal, bankAsOfDate, sharedChecksObservedSequence, bankCurrentBalance, nextCreditCycle, modalFormSnapshot, armModalDraftGuard, modalHasUnsavedDraft, clearModalDraftGuard, configureCloudConnectButton, handleCloudConnectButton, setCloudHeaderStatus, setSaveStatus=()=>{}, setConnectedStatus=()=>{}, requestPersistentBrowserStorage, loadSharedChecksBase, loadSharedChecksBankEvents, getSharedChecksPending, sharedChecksPendingExists, showSecondaryTabGuard, acquirePrimaryTabLock, chooseFolder, chooseDataFile, restoreRememberedBackupTarget, supaConfigured, restoreSupaSession, resumeIncompleteRestore=async()=>false, showCloudNoDocument, tryAutoOpenSupabase, setConnectUI, showFirstRun, tryAutoOpenRemembered}){
function runtimeSelfCheck(){
  const required={assertValidCloudState,normalizeSharedChecks,prepareKupaCloudState,saveChecksState,saveSharedChecksToCloud,syncSharedChecksFromCloud,pollSharedChecks,num,money,dateFmt,todayISO,localISO,dObj,daysFromToday,monthKey,monthLabel,addMonthsISO,checkDateParts,checkDateEditorMarkup,checkDateEditorValue,commitCheckDateEditor,setCheckDateValue,normalizeCheckModalDates,uid,activeChecks,depositedChecks,cashBalance,checksBalance,depositedBalance,checkUrgency,rawCreditSchedule,creditSchedule,inactiveCreditExpired,creditProgress,pendingInstallments,allInstallments,monthSumInstallments,expenseOccurrencesForMonth,monthSumExpenses,bankBaseBalance,bankAdjustments,bankAdjustmentsTotal,bankCurrentBalance,bankAsOfDate,sharedChecksObservedSequence,normalizeSharedBankEvents,monthKeysBetween,nextCreditCycle,modalFormSnapshot,armModalDraftGuard,modalHasUnsavedDraft,clearModalDraftGuard,openLastFolder};
  const missing=Object.entries(required).filter(([,fn])=>typeof fn!=='function').map(([name])=>name);
  if(missing.length){
    console.error('Kupa runtime self-check failed. Missing helpers:',missing);
    alert('קובץ המערכת אינו שלם. חסרים רכיבי ליבה: '+missing.join(', ')+'.\nיש להחליף את site/index.html בגרסה התקינה.');
    return false;
  }
  try{normalizeState(INITIAL_STATE)}catch(e){console.error('Kupa state self-check failed:',e);alert('בדיקת תקינות נתוני המערכת נכשלה: '+e.message);return false}
  return true;
}

async function retryReadOnlyRecovery(fn,{attempts=6,delay=60}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    try{const result=await fn();if(result)return result}catch(error){if(attempt===attempts-1)console.error('secondary read-only recovery',error)}
    if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,delay));
  }
  return false;
}

async function boot(){
  if(!runtimeSelfCheck())return;
  await acquirePrimaryTabLock();
  // Storage ownership is durable and independent from the auth token. Establish
  // it before any account-scoped marker, snapshot or writer can be consulted.
  await hydrateStorageOwner();
  const restoredAuth=await restoreSupaSession();await hydrateStorageTransition();await hydrateLocalBirth();await hydrateStorageV2OwnerTransfer();
  let cutoverActive=await verifyStorageCutover(),localEngineActive=await verifyLocalStorageEngine(),transitionPreparing=storageTransitionPreparing();
  if(!tab.primaryTab){
    const v2Required=storageV2OwnerTransferPreparing()||cutoverActive||localEngineActive||transitionPreparing||localBirthPreparing();
    let shown=false;
    if(v2Required){
      const mainRecovered=await retryReadOnlyRecovery(()=>recoverReadOnlyV2State());
      const sharedRecovered=mainRecovered&&await retryReadOnlyRecovery(()=>recoverSharedChecksV2ReadOnly());
      shown=!!(mainRecovered&&sharedRecovered);
      if(shown)render();
    }else shown=await openBrowserStateReadOnly();
    showSecondaryTabGuard();
    setConnectedStatus('לקריאה בלבד');setSaveStatus(shown?'לקריאה בלבד':'קריאה בלבד — רענן לאחר סיום האתחול בטאב הראשי',shown?'':'error');
    setCloudHeaderStatus('offline',shown?'ענן: קריאה בלבד':'ענן: קריאה בלבד — הנתונים טרם זמינים');
    return;
  }
  if(storageV2OwnerTransferPreparing()){
    if(!navigator.onLine||!restoredAuth){session.backendReady=false;setConnectUI({title:'מעבר החשבון ממתין',text:'העריכה נעולה עד לחיבור מחדש לחשבון היעד ולהשלמת המעבר.',showCloud:true});return}
    try{await resumeStorageV2OwnerTransfer();cutoverActive=await verifyStorageCutover();localEngineActive=await verifyLocalStorageEngine();transitionPreparing=storageTransitionPreparing()}
    catch(error){console.error('Kupa V2 owner transfer resume',error);session.backendReady=false;setConnectUI({title:'מעבר החשבון נעצר בבטחה',text:'הנתונים נשמרו. יש להתחבר לחשבון היעד ולהשלים את המעבר לפני עריכה.',showCloud:true});return}
  }
  // Birth is a durable transition, and its Main checkpoint is not complete
  // until Shared and the local marker are verified. Keep the screen closed.
  if(!cutoverActive){
    try{await ensureLocalBirth();localEngineActive=await verifyLocalStorageEngine()}
    catch(error){console.error('Kupa local V2 birth',error);setConnectUI({title:'מעבר האחסון המקומי נעצר',text:'הנתונים הישנים נשארו שמורים. העריכה חסומה עד להשלמת מעבר האחסון או בדיקת התקלה.',showCloud:false});return}
  }
  document.getElementById('chooseFolder').addEventListener('click',chooseFolder);
  document.getElementById('chooseDataFile').addEventListener('click',chooseDataFile);
  document.getElementById('openLastFolder').addEventListener('click',openLastFolder);
  document.getElementById('openCloud').addEventListener('click',handleCloudConnectButton);

  const cloudPreferred=localStorage.getItem(STORAGE_PREF_KEY)==='supabase';
  let startupLocalShown=false;
  if(localEngineActive)await recoverLocalV2State();
  else if(cloudPreferred||cutoverActive||transitionPreparing){
    session.startupCloudHydrating=!!navigator.onLine;
    try{startupLocalShown=await openBrowserStateFallback({startup:true,deferRender:cutoverActive||transitionPreparing})}catch(error){if(cutoverActive)throw error;console.error('startup browser state recovery',error)}
  }

  let sharedPrimary=false;

  if(supaConfigured())setCloudHeaderStatus('syncing',startupLocalShown&&navigator.onLine?'ענן: מסנכרן…':'ענן: בודק…');else setCloudHeaderStatus('off','ענן: לא מוגדר');
  const persistentStoragePromise=requestPersistentBrowserStorage().catch(error=>console.error('persistent browser storage',error));
  await restoreRememberedBackupTarget();
  await persistentStoragePromise;

  // Main's checkpoint still carries a legacy checks copy. Hydrate its Shared
  // owner before any offline or cloud-capability exit can show business data.
  if((cutoverActive||localEngineActive)&&!transitionPreparing){sharedPrimary=await recoverSharedChecksV2Primary();if(!sharedPrimary)throw new Error('shared_checks_cutover_recovery_required');if(startupLocalShown)render()}
  if(localEngineActive){session.startupCloudHydrating=false;if(await tryAutoOpenRemembered())return;showFirstRun();return}
  if(!navigator.onLine&&startupLocalShown&&!transitionPreparing){session.startupCloudHydrating=false;return}
  if(navigator.onLine&&restoredAuth){try{await ensureSyncCapabilities();session.syncCapabilitiesError=null}catch(error){session.syncCapabilitiesError=error;setCloudHeaderStatus('conflict',error.message);setConnectUI({title:'ה־DB אינו תואם לגרסת האתר',text:error.message,showCloud:false});}}
  if(session.syncCapabilitiesError){if(!startupLocalShown)await openBrowserStateFallback();session.startupCloudHydrating=false;setCloudHeaderStatus('conflict',session.syncCapabilitiesError.message);return}
  transitionPreparing=storageTransitionPreparing();
  if(transitionPreparing){
    if(!navigator.onLine||!restoredAuth){if(startupLocalShown)render();session.startupCloudHydrating=false;setCloudHeaderStatus('conflict','ענן: מעבר Storage V2 ממתין להתחברות ולרשת');setConnectUI({title:'מעבר האחסון ממתין להשלמה',text:'העריכה נעולה עד חידוש החיבור והשלמת מעבר Storage V2.',showCloud:true});return}
    try{await resumeStorageTransition();cutoverActive=await verifyStorageCutover();if(!cutoverActive)throw new Error('storage_cutover_marker_verification_failed')}
    catch(error){console.error('Storage V2 cutover resume',error);if(startupLocalShown)render();session.startupCloudHydrating=false;setCloudHeaderStatus('conflict','ענן: מעבר Storage V2 דורש השלמה');setConnectUI({title:'מעבר האחסון נעצר בבטחה',text:error?.message||String(error),note:'פתיחת ענן רגילה חסומה בזמן מעבר פעיל כדי למנוע ערבוב בין V1 ל־V2. לאחר תיקון התקלה יש לרענן את הדף כדי לחדש את אותה תוכנית מעבר שמורה.',showCloud:false});return}
  }
  if(cutoverActive&&!sharedPrimary){sharedPrimary=await recoverSharedChecksV2Primary();if(!sharedPrimary)throw new Error('shared_checks_cutover_recovery_required');if(startupLocalShown)render()}
  if(!sharedPrimary)sharedPrimary=await recoverSharedChecksV2Primary();
  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloudHeaderStatus('conflict','ענן: שחזור ממתין')}
  if(!sharedPrimary){checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();const checksOutbox=await getSharedChecksPending();if(checksOutbox?.snapshot)model.state.checks=normalizeSharedChecks(checksOutbox.snapshot);if(checksOutbox||sharedChecksPendingExists()){checksSession.sharedChecksGeneration=Math.max(checksSession.sharedChecksGeneration,Number(checksOutbox?.generation||1));checksSession.sharedChecksSaveRequested=true}}
  let autoOpened=false;
  try{autoOpened=await tryAutoOpenSupabase()}finally{session.startupCloudHydrating=false}
  if(autoOpened)return;
  if(session.cloudAuthNoDocument){await showCloudNoDocument();return}
  if(startupLocalShown){if(!restoredAuth)setCloudHeaderStatus('off','ענן: נדרשת התחברות');return}
  if(!window.isSecureContext){
    configureCloudConnectButton('פתח קופה מהענן','open');
    setConnectUI({title:'נדרשת פתיחה ב־Chrome או Edge',text:'הדפדפן לא פתח את הקובץ כהקשר מקומי מאובטח.',note:'אפשר עדיין לפתוח קופה בענן Supabase, או לפתוח את <b>site/index.html</b> דרך HTTPS או שרת פיתוח מקומי (localhost) ב־Chrome/Edge עדכני.',showChoose:!!window.showDirectoryPicker,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
    return;
  }
  if(await tryAutoOpenRemembered())return;
  showFirstRun();
}

return { runtimeSelfCheck, boot };
}
