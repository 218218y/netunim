import {$} from '../state/constants.js';
import {formatCloudSyncTime, latestCloudUpdatedAt} from '../core/dates.js';

const STARTUP_DOMAIN_ORDER=['orders','checks','finance'];
const STARTUP_DOMAIN_LABELS={orders:'ניהול הזמנות',checks:'צ׳קים',finance:'בנק ואשראי'};
const STARTUP_LOADING_TEXT={orders:'ענן: מאמת נתוני הזמנות…',checks:'ענן: מסנכרן צ׳קים…',finance:'ענן: מסנכרן בנק ואשראי…'};

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiStatus({session, checksSession}){
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2600)}

function setSave(text,cls='',title=''){const e=$('#savePill');if(e){e.textContent=text;e.className='save-pill '+cls;e.title=title||''}}

function latestSyncedAt(){return latestCloudUpdatedAt(session.cloudUpdatedAt,checksSession.checksCloudUpdatedAt,checksSession.financeReadUpdatedAt)}
function syncedCloudText(text='ענן: מסונכרן'){const at=latestSyncedAt();return at?`${text} ${formatCloudSyncTime(at)}`:text}
function setCloud(text,cls='',title=''){const e=$('#cloudPill');if(e){e.textContent=cls==='synced'?syncedCloudText(text):text;e.className='cloud-pill '+cls;e.title=title||''}}
function refreshCloudTimestamp(){const e=$('#cloudPill');if(e?.classList.contains('synced'))setCloud('ענן: מסונכרן','synced',e.title)}

function startupDomains(){
  if(!session.startupSync||typeof session.startupSync!=='object')session.startupSync={active:false,domains:{}};
  if(!session.startupSync.domains||typeof session.startupSync.domains!=='object')session.startupSync.domains={};
  for(const domain of STARTUP_DOMAIN_ORDER){
    if(!session.startupSync.domains[domain])session.startupSync.domains[domain]={required:false,state:'idle',error:''};
  }
  return session.startupSync.domains;
}
function startupDetail(){
  const domains=startupDomains();
  return STARTUP_DOMAIN_ORDER.filter(domain=>domains[domain].required).map(domain=>{
    const item=domains[domain],label=STARTUP_DOMAIN_LABELS[domain],state=item.state;
    if(state==='ready')return `${label} — מסונכרן`;
    if(state==='deferred')return `${label} — נשמר מקומית וממתין לסנכרון`;
    if(state==='error')return `${label} — טעינה נכשלה${item.error?`: ${item.error}`:''}`;
    if(state==='loading'||state==='pending')return `${label} — בתהליך`;
    return `${label} — לא נדרש`;
  }).join('\n');
}
function refreshStartupCloudStatus(){
  const sync=session.startupSync,domains=startupDomains(),required=STARTUP_DOMAIN_ORDER.filter(domain=>domains[domain].required);
  if(!required.length){sync.active=false;return}
  const busy=required.find(domain=>domains[domain].state==='loading'||domains[domain].state==='pending');
  if(busy){sync.active=true;setCloud(STARTUP_LOADING_TEXT[busy],'',startupDetail());return}
  sync.active=false;
  const partial=required.some(domain=>domains[domain].state==='error'||domains[domain].state==='deferred');
  if(partial)setCloud('ענן: סנכרון חלקי ⚠','error',startupDetail());
  else setCloud('ענן: מסונכרן','synced',startupDetail());
}
function beginStartupSync(required={}){
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
  if(!startupDomainLocked(domain))return true;
  const label=domain==='all'?'הנתונים':STARTUP_DOMAIN_LABELS[domain]||'הנתונים';
  toast(`${label} עדיין מאומתים מול הענן. אפשר לצפות כעת; העריכה תיפתח מיד כשהשלב הבטוח יסתיים.`);
  return false;
}

function reportError(message){alert(message)}
function hideConnectScreen(){document.getElementById('connectScreen').style.display='none'}

return { reportError, hideConnectScreen, toast, setSave, setCloud, refreshCloudTimestamp, beginStartupSync, setStartupDomain, startupDomainLocked, guardStartupMutation };
}
