import {uid} from './core/values.js';
import {num, money} from './core/money.js';
import {dateFmt, todayISO, localISO, dObj, daysFromToday, monthKey, monthLabel, addMonthsISO, monthKeysBetween, checkDateParts} from './core/dates.js';
import {assertValidCloudState} from './state/validation.js';
import {normalizeSharedBankEvents, normalizeSharedChecks, checkUrgency} from './domains/checks/model.js';
import {rawCreditSchedule, creditSchedule, inactiveCreditExpired, creditProgress} from './domains/credit/model.js';
import {INITIAL_STATE} from './state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({session, tab, checksSession, prepareKupaCloudState, normalizeState, saveChecksState, syncSharedChecksFromCloud, saveSharedChecksToCloud, pollSharedChecks, openLastFolder, checkDateEditorMarkup, checkDateEditorValue, commitCheckDateEditor, setCheckDateValue, normalizeCheckModalDates, activeChecks, depositedChecks, cashBalance, checksBalance, depositedBalance, pendingInstallments, allInstallments, monthSumInstallments, expenseOccurrencesForMonth, monthSumExpenses, bankBaseBalance, bankAdjustments, bankAdjustmentsTotal, bankAsOfDate, sharedChecksObservedSequence, bankCurrentBalance, nextCreditCycle, modalFormSnapshot, armModalDraftGuard, modalHasUnsavedDraft, clearModalDraftGuard, configureCloudConnectButton, handleCloudConnectButton, setCloudHeaderStatus, requestPersistentBrowserStorage, loadSharedChecksBase, loadSharedChecksBankEvents, getSharedChecksPending, sharedChecksPendingExists, showSecondaryTabGuard, acquirePrimaryTabLock, chooseFolder, chooseDataFile, restoreRememberedBackupTarget, supaConfigured, restoreSupaSession, resumeIncompleteRestore=async()=>false, showCloudNoDocument, tryAutoOpenSupabase, setConnectUI, showFirstRun, tryAutoOpenRemembered}){
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

async function boot(){
  if(!runtimeSelfCheck())return;
  await acquirePrimaryTabLock();
  if(!tab.primaryTab){showSecondaryTabGuard();return}
  await requestPersistentBrowserStorage();
  document.getElementById('chooseFolder').addEventListener('click',chooseFolder);
  document.getElementById('chooseDataFile').addEventListener('click',chooseDataFile);
  document.getElementById('openLastFolder').addEventListener('click',openLastFolder);
  document.getElementById('openCloud').addEventListener('click',handleCloudConnectButton);
  if(supaConfigured())setCloudHeaderStatus('syncing','ענן: בודק…');else setCloudHeaderStatus('off','ענן: לא מוגדר');
  await restoreRememberedBackupTarget();
  await restoreSupaSession();
  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloudHeaderStatus('conflict','ענן: שחזור ממתין')}
  checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();const checksOutbox=await getSharedChecksPending();if(checksOutbox?.snapshot)model.state.checks=normalizeSharedChecks(checksOutbox.snapshot);if(checksOutbox||sharedChecksPendingExists()){checksSession.sharedChecksGeneration=Math.max(checksSession.sharedChecksGeneration,Number(checksOutbox?.generation||1));checksSession.sharedChecksSaveRequested=true}
  if(await tryAutoOpenSupabase())return;
  if(session.cloudAuthNoDocument){await showCloudNoDocument();return}
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
