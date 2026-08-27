import {$} from '../state/constants.js';
import {formatCloudSyncTime, latestCloudUpdatedAt} from '../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiStatus({session, checksSession}){
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2600)}

function setSave(text,cls='',title=''){const e=$('#savePill');if(e){e.textContent=text;e.className='save-pill '+cls;e.title=title||''}}

function latestSyncedAt(){return latestCloudUpdatedAt(session.cloudUpdatedAt,checksSession.checksCloudUpdatedAt)}
function syncedCloudText(text='ענן: מסונכרן'){const at=latestSyncedAt();return at?`${text} ${formatCloudSyncTime(at)}`:text}
function setCloud(text,cls=''){const e=$('#cloudPill');if(e){e.textContent=cls==='synced'?syncedCloudText(text):text;e.className='cloud-pill '+cls}}
function refreshCloudTimestamp(){const e=$('#cloudPill');if(e?.classList.contains('synced'))setCloud('ענן: מסונכרן','synced')}

function reportError(message){alert(message)}
function hideConnectScreen(){document.getElementById('connectScreen').style.display='none'}

return { reportError, hideConnectScreen, toast, setSave, setCloud, refreshCloudTimestamp };
}
