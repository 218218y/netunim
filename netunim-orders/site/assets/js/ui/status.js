import {$} from '../state/constants.js';
import {formatCloudSyncTime, latestCloudUpdatedAt} from '../core/dates.js';

const STARTUP_DOMAIN_ORDER=['orders','checks','finance'];
const HEADER_DOMAIN_ORDER=['orders','checks'];
const STARTUP_DOMAIN_LABELS={orders:'ניהול הזמנות',checks:'צ׳קים',finance:'בנק ואשראי'};
const STARTUP_LOADING_TEXT={orders:'ענן: מאמת נתוני הזמנות…',checks:'ענן: מסנכרן צ׳קים…'};

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiStatus({session, checksSession, tab, storageRecovery}){
if(typeof storageRecovery?.isReady!=='function')throw new TypeError('ui_storage_recovery_required');
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2600)}

function setSave(text,cls='',title=''){const e=$('#savePill');if(e){e.textContent=text;e.className='save-pill '+cls;e.title=title||''}}

function latestSyncedAt(){return latestCloudUpdatedAt(session.cloudUpdatedAt,checksSession.checksCloudUpdatedAt)}
function syncedCloudText(text='ענן: מסונכרן'){const at=latestSyncedAt();return at?`${text} ${formatCloudSyncTime(at)}`:text}
const cloudStatuses=new Map();
function renderCloudStatus(){
  const e=$('#cloudPill');if(!e)return;
  const main=cloudStatuses.get('orders');
  if(main?.cls==='off'){e.textContent=main.text;e.className='cloud-pill';e.title=main.title;return}
  const domains=startupDomains(),statuses=HEADER_DOMAIN_ORDER.map(domain=>{
    // Once the live capability publishes, startup bookkeeping no longer owns
    // this document's outcome. Finance never owns an Orders/Checks header slot.
    const live=cloudStatuses.get(domain);if(live)return {...live,domain};
    const item=domains[domain];if(item.required){
      const cls=item.state==='ready'?'synced':item.state==='error'||item.state==='deferred'?'error':'';
      const text=item.state==='ready'?'ענן: מסונכרן':cls==='error'?'ענן: סנכרון חלקי ⚠':STARTUP_LOADING_TEXT[domain];
      return {domain,cls,text,title:item.error};
    }
    if(domain==='checks'&&main?.cls==='synced')return {domain,cls:'',text:'ענן: צ׳קים טרם אומתו',title:''};
    return null;
  }).filter(Boolean);
  if(!statuses.length)return;
  const priority={error:4,offline:3,'':2,synced:1};
  const selected=statuses.reduce((best,item)=>!best||(priority[item.cls]||0)>(priority[best.cls]||0)?item:best,null);
  e.textContent=selected.cls==='synced'?syncedCloudText(selected.text):selected.text;
  e.className='cloud-pill '+selected.cls;
  e.title=statuses.map(item=>`${STARTUP_DOMAIN_LABELS[item.domain]} — ${item.text}${item.title?`: ${item.title}`:''}`).join('\n');
}
function setCloud(text,cls='',title=''){
  if(cls==='off')cloudStatuses.clear();
  cloudStatuses.set('orders',{text,cls,title});renderCloudStatus();
}
function setChecksCloud(text,cls='',title=''){cloudStatuses.set('checks',{text,cls,title});renderCloudStatus()}
function refreshCloudTimestamp(){renderCloudStatus()}

function startupDomains(){
  if(!session.startupSync||typeof session.startupSync!=='object')session.startupSync={active:false,domains:{}};
  if(!session.startupSync.domains||typeof session.startupSync.domains!=='object')session.startupSync.domains={};
  for(const domain of STARTUP_DOMAIN_ORDER){
    if(!session.startupSync.domains[domain])session.startupSync.domains[domain]={required:false,state:'idle',error:''};
  }
  return session.startupSync.domains;
}
function refreshStartupCloudStatus(){
  const sync=session.startupSync,domains=startupDomains(),required=HEADER_DOMAIN_ORDER.filter(domain=>domains[domain].required);
  if(!required.length){sync.active=false;return}
  const busy=required.find(domain=>domains[domain].state==='loading'||domains[domain].state==='pending');
  if(busy){sync.active=true;renderCloudStatus();return}
  sync.active=false;
  renderCloudStatus();
}
function beginStartupSync(required={}){
  cloudStatuses.clear();
  const domains=startupDomains();
  for(const domain of STARTUP_DOMAIN_ORDER){const needed=!!required[domain];domains[domain]={required:needed,state:needed?'pending':'skipped',error:''}}
  session.startupSync.active=STARTUP_DOMAIN_ORDER.some(domain=>domains[domain].required);
  refreshStartupCloudStatus();
}
function setStartupDomain(domain,state,error=''){
  if(!STARTUP_DOMAIN_ORDER.includes(domain))throw new Error('Unknown startup sync domain: '+domain);
  const domains=startupDomains(),item=domains[domain];item.state=state;item.error=error?String(error):'';refreshStartupCloudStatus();
}
function startupDomainLocked(domain){
  const domains=startupDomains();
  if(domain==='all')return STARTUP_DOMAIN_ORDER.some(name=>domains[name].required&&(domains[name].state==='pending'||domains[name].state==='loading'));
  const item=domains[domain];return !!item?.required&&(item.state==='pending'||item.state==='loading');
}
function guardStartupMutation(domain='orders'){
  const label=domain==='all'?'הנתונים':STARTUP_DOMAIN_LABELS[domain]||'הנתונים';
  if(session.storageProtocolBlocked){toast('העריכה חסומה עד לאימות שדרוג האחסון. יש לרענן לאחר התחברות וחיבור לרשת.');return false}
  if(tab&&!tab.primaryTab){toast('לקריאה בלבד — העריכה זמינה בטאב הראשי.');return false}
  if(!storageRecovery.isReady()){toast('העריכה חסומה עד להשלמת שחזור הנתונים המקומיים והצ׳קים המשותפים.');return false}
  if(session.syncCapabilitiesError){
    toast(session.syncCapabilitiesError.message||'מסד הנתונים אינו תואם לגרסת האתר. אפשר לצפות בנתונים, אך העריכה חסומה.');
    return false;
  }
  if(session.syncCapabilitiesChecking){
    toast(`${label} זמינים לצפייה; העריכה תיפתח מיד לאחר אימות תאימות מסד הנתונים.`);
    return false;
  }
  if(!startupDomainLocked(domain))return true;
  toast(`${label} עדיין מאומתים מול הענן. אפשר לצפות כעת; העריכה תיפתח מיד כשהשלב הבטוח יסתיים.`);
  return false;
}

function reportError(message){alert(message)}
function hideConnectScreen(){document.getElementById('connectScreen').style.display='none'}

return { reportError, hideConnectScreen, toast, setSave, setCloud, setChecksCloud, refreshCloudTimestamp, beginStartupSync, setStartupDomain, startupDomainLocked, guardStartupMutation };
}
