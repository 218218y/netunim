import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {formatCloudSyncTime, latestCloudUpdatedAt} from '../core/dates.js';
import {SECONDARY_READ_ONLY_ACTIONS} from './secondary-read-only-actions.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiStatus({session, checksSession, tab, storageRecovery}){
if(typeof storageRecovery?.isReady!=='function')throw new TypeError('ui_storage_recovery_required');
// Main and Shared Checks own separate sync outcomes. A successful read of one
// document cannot acknowledge pending work or an error in the other document.
const cloudStatuses=new Map(),saveStatuses=new Map();
function selectStatus(statuses,priority){return [...statuses.values()].reduce((selected,status)=>!selected||(priority[status.mode]||0)>(priority[selected.mode]||0)?status:selected,null)}
function setSaveStatus(text,cls='',source='main'){
  saveStatuses.set(source,{text,mode:cls});
  const status=selectStatus(saveStatuses,{error:3,saving:2,ok:1});
  const el=document.getElementById('saveIndicator');if(!el)return;
  const cloud=session.connectionMode==='supabase';
  const blocked=cloud&&session.cloudConflictPending;
  el.hidden=cloud&&!blocked&&status.mode==='ok';
  el.textContent=blocked?'סנכרון הקופה נעצר — נדרשת בדיקת המצב המקומי':status.text;
  el.className='save-indicator hide-mobile '+(blocked?'error':status.mode);
}

function setConnectedStatus(text='קובץ נתונים מחובר'){
  const st=document.getElementById('dbStatus');if(!st)return;
  const cloud=session.connectionMode==='supabase';
  st.hidden=cloud;
  st.className='file-status hide-mobile';
  st.replaceChildren(document.createElement('i'),document.createTextNode(' '+text));
}

function supaProjectRef(){try{return new URL(SUPA_CONFIG.url).hostname.split('.')[0]||'—'}catch(e){return '—'}}

function latestSyncedAt(){return latestCloudUpdatedAt(session.serverInfo?.lastSavedAt,checksSession.sharedChecksUpdatedAt)}
function syncedHeaderText(text='ענן: מסונכרן'){const at=latestSyncedAt();return at?`${text} ${formatCloudSyncTime(at)}`:text}

function renderCloudHeader(){
  const el=document.getElementById('cloudHeaderStatus');if(!el)return;
  const status=selectStatus(cloudStatuses,{conflict:5,auth:4,offline:3,syncing:2,synced:1})||{mode:'off',text:'ענן: לא מחובר'};
  const blocked=session.connectionMode==='supabase'&&session.cloudConflictPending&&status.mode!=='off';
  const mode=blocked?'conflict':status.mode,text=blocked?'ענן: התנגשות':status.text;
  const shown=mode==='synced'?syncedHeaderText(text):text;
  el.className='cloud-head-status hide-mobile '+mode;
  el.replaceChildren(document.createElement('i'),document.createTextNode(' '+shown));el.title=`Supabase · project ${supaProjectRef()}`;
}
function setCloudHeaderStatus(mode='off',text='ענן: לא מחובר',source='main'){
  if(source==='main'&&mode==='off'){cloudStatuses.clear();saveStatuses.clear()}
  cloudStatuses.set(source,{mode,text});renderCloudHeader();
}

function refreshCloudHeaderTimestamp(){renderCloudHeader()}

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}


function canRunInteractiveAction(name=''){
  if(!tab.primaryTab&&!SECONDARY_READ_ONLY_ACTIONS.has(name)){toast('לקריאה בלבד — העריכה זמינה בטאב הראשי.');return false}
  if(name==='reset-local-site-storage')return true;
  if(session.storageProtocolBlocked){toast('העריכה חסומה עד לאימות שדרוג האחסון. יש לרענן לאחר התחברות וחיבור לרשת.');return false}
  if(!storageRecovery.isReady()){toast('העריכה חסומה עד להשלמת שחזור הנתונים המקומיים והצ׳קים המשותפים.');return false}
  if(session.syncCapabilitiesError){toast('העריכה חסומה עד להשלמת התאמת מסד הנתונים לגרסת האתר.');return false}
  if(session.syncCapabilitiesChecking||session.startupCloudHydrating){toast('הנתונים המקומיים כבר מוצגים; העריכה תיפתח מיד לאחר אימות הענן.');return false}
  return true
}

function reportError(message){alert(message)}
function hideConnectScreen(){document.getElementById('connectScreen').style.display='none'}

return { reportError, hideConnectScreen, setSaveStatus, setConnectedStatus, supaProjectRef, setCloudHeaderStatus, refreshCloudHeaderTimestamp, toast, canRunInteractiveAction };
}
