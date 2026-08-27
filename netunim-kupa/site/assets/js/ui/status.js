import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {formatCloudSyncTime, latestCloudUpdatedAt} from '../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiStatus({session, checksSession}){
function setSaveStatus(text,cls=''){
  const el=document.getElementById('saveIndicator');if(!el)return;
  const cloud=session.connectionMode==='supabase';
  el.hidden=cloud&&cls==='ok';
  el.textContent=text;
  el.className='save-indicator hide-mobile '+cls;
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

function setCloudHeaderStatus(mode='off',text='ענן: לא מחובר'){const el=document.getElementById('cloudHeaderStatus');if(!el)return;const shown=mode==='synced'?syncedHeaderText(text):text;el.className='cloud-head-status hide-mobile '+(mode||'');el.replaceChildren(document.createElement('i'),document.createTextNode(' '+shown));el.title=`Supabase · project ${supaProjectRef()}`}

function refreshCloudHeaderTimestamp(){const el=document.getElementById('cloudHeaderStatus');if(el?.classList.contains('synced'))setCloudHeaderStatus('synced','ענן: מסונכרן')}

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}

function reportError(message){alert(message)}
function hideConnectScreen(){document.getElementById('connectScreen').style.display='none'}

return { reportError, hideConnectScreen, setSaveStatus, setConnectedStatus, supaProjectRef, setCloudHeaderStatus, refreshCloudHeaderTimestamp, toast };
}
