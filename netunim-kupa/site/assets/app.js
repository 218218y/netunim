const HEB_MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const TITLES={dashboard:['לוח בקרה','תמונת מצב ופעולות שוטפות'],checks:['צקים','ניהול, הפקדה ומעקב לפי חודשים'],credit:['אשראי','עסקאות ותשלומים עתידיים'],cash:['מזומן','תנועות ויתרה מחושבת'],bank:['בנק','עובר ושב, אשראי והוצאות קבועות'],settings:['הגדרות וגיבוי','כרטיסים, גיבוי ושחזור נתונים']};
const SUPA_CONFIG=window.KUPA_SUPABASE_CONFIG||{};
const SUPA_SESSION_KEY='kupa.supabase.session.v1',SUPA_SESSION_IDB_KEY='supabase-session-v2',SUPA_EMAIL_KEY='kupa.supabase.email.v1',SUPA_AUTO_KEY='kupa.supabase.auto.v1',STORAGE_PREF_KEY='kupa.storage.preferred.v1';
const BROWSER_STATE_KEY='kupa.browser.state.v1',BROWSER_STATE_IDB_KEY='browser-state-v1',CLOUD_PENDING_LOCAL_KEY='kupa.cloud.pending.local.v1',TAB_LOCK='kupa-primary-writer';
const SHARED_CHECKS_DOC='main',SHARED_CHECKS_TABLE='shared_checks_documents',SHARED_CHECKS_RPC='save_shared_checks_document';
const SHARED_CHECKS_BASE_KEY='kupa.shared.checks.base.v1',SHARED_CHECKS_EVENTS_KEY='kupa.shared.checks.bank-events.v1',SHARED_CHECKS_PENDING_KEY='kupa.shared.checks.pending.v1';
const DATA_FILE='kupa-data.json',BACKUP_PREFIX='kupa-backup_',AUTO_BACKUP_INTERVAL_MS=12*60*60*1000,AUTO_BACKUP_PREFIX='kupa-backup-auto_',AUTO_BACKUP_KEEP=60;

let state={version:4,businessName:'ניהול קופה',checks:[],credits:[],cash:[],expenses:[],cards:[],bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:[]}};
const INITIAL_STATE={"version":4,"businessName":"ניהול קופה","checks":[],"credits":[],"cash":[],"expenses":[],"cards":[],"bank":{"currentBalance":null,"updatedAt":null,"asOfDate":null,"adjustments":[]}};
let dbRevision=0, backendReady=false, saveQueue=Promise.resolve(), localGeneration=0, currentPage='checks', checkTab='open', checkYear='all', checkFocus='all', creditView='rolling12';
let bulkCollection=null,bulkSelected=new Set();
let rootDirHandle=null, backupRootDirHandle=null, dataFileHandle=null, backupsDirHandle=null, connectionMode='directory', serverInfo={schemaVersion:6,backups:[]}, lastSavedSnapshot='', lastNormalizeRemovedCredits=0;
let supaSession=null, cloudDocumentName='main', cloudSyncBusy=false, cloudWriteBusy=false, cloudPollTimer=null, cloudConflictPending=false, cloudAuthNoDocument=false, autoBackupTimer=null, pendingAutoBackupPayload=null, browserStatePendingRecord=null, browserStateWritePromise=null, primaryTab=true, primaryTabReady=false, primaryLockRelease=null, localFileConflictPending=false;
let sharedChecksRevision=0,sharedChecksBase=null,sharedChecksBankEvents=[],sharedChecksBusy=false,sharedChecksSavePromise=null,sharedChecksSaveRequested=false,sharedChecksGeneration=0,sharedChecksSaveTimer=null,sharedChecksLastError='',sharedChecksBootstrapActive=true;
let modalDraftGuard=null;
function clone(x){return JSON.parse(JSON.stringify(x))}
function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
let cloudConnectAction='open';
function configureCloudConnectButton(label='פתח קופה מהענן',action='open'){
  cloudConnectAction=action;
  const b=document.getElementById('openCloud');
  if(b)b.textContent=label;
}
async function handleCloudConnectButton(){
  if(cloudConnectAction==='reauth'){
    storeSupaSession(null);
    cloudAuthNoDocument=false;
    setCloudHeaderStatus('off','ענן: נדרשת התחברות');
    openSupabaseLoginModal('open');
    return;
  }
  await openCloudUsingSavedSession({interactive:true});
}
function validState(d){return d&&Array.isArray(d.checks)&&Array.isArray(d.credits)&&Array.isArray(d.cash)&&Array.isArray(d.expenses)&&Array.isArray(d.cards)}
function validKupaCloudState(d){return !!(d&&typeof d==='object'&&!Array.isArray(d)&&!Object.prototype.hasOwnProperty.call(d,'checks')&&Array.isArray(d.credits)&&Array.isArray(d.cash)&&Array.isArray(d.expenses)&&Array.isArray(d.cards)&&d.bank&&typeof d.bank==='object'&&!Array.isArray(d.bank)&&Array.isArray(d.bank.adjustments)&&!d.bank.adjustments.some(a=>a?.type==='check_deposit'))}
function assertValidCloudState(d,context='נתוני הקופה'){
  if(!validKupaCloudState(d))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);
  return d
}
function normalizeSharedBankEvents(events){return (Array.isArray(events)?events:[]).map(e=>{const seq=Number(e?.seq),delta=wholeMoney(e?.delta);return{seq:Number.isSafeInteger(seq)&&seq>0?seq:null,at:e?.at||null,delta,kind:String(e?.kind||'check_effect_delta'),checkId:String(e?.checkId||'')}}).filter(e=>e.seq&&e.checkId)}
function normalizeSharedChecks(checks){return (Array.isArray(checks)?checks:[]).filter(x=>x&&x.id).map(x=>{const seq=Number(x.depositSeq);return {...x,id:String(x.id),name:String(x.name||''),amount:wholeMoney(x.amount),dueDate:String(x.dueDate||''),status:String(x.status||'בקופה'),depositDate:x.depositDate||null,depositedAt:x.depositedAt||null,depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,clearedDate:x.clearedDate||null,checkNumber:String(x.checkNumber||''),note:String(x.note||''),createdAt:x.createdAt||''}})}
function prepareKupaCloudState(source=state){const x=normalizeState(clone(source));delete x.checks;x.bank={...x.bank,adjustments:(x.bank.adjustments||[]).filter(a=>a?.type!=='check_deposit')};return x}
function applyKupaCloudState(cloudState,checks=state.checks){const x=normalizeState({...clone(cloudState||{}),checks:normalizeSharedChecks(checks)});x.bank.adjustments=(x.bank.adjustments||[]).filter(a=>a?.type!=='check_deposit');return x}
function normalizeState(d){
  const n=clone(d||{});
  n.version=Math.max(Number(n.version||1),4);
  n.bank=(n.bank&&typeof n.bank==='object')?n.bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:[]};
  if(n.bank.currentBalance===''||n.bank.currentBalance===undefined)n.bank.currentBalance=null;
  if(n.bank.currentBalance!==null)n.bank.currentBalance=wholeMoney(n.bank.currentBalance);
  n.bank.updatedAt=n.bank.updatedAt||null;
  n.bank.asOfDate=n.bank.asOfDate||(n.bank.updatedAt?String(n.bank.updatedAt).slice(0,10):null);
  n.bank.snapshotToken=n.bank.snapshotToken?String(n.bank.snapshotToken):null;
  {const seq=Number(n.bank.snapshotSeq);n.bank.snapshotSeq=Number.isSafeInteger(seq)&&seq>=0?seq:null}
  n.bank.adjustments=Array.isArray(n.bank.adjustments)?n.bank.adjustments.map(x=>({...x,amount:wholeMoney(x.amount)})):[];
  n.checks=normalizeSharedChecks(n.checks);
  n.cash=(n.cash||[]).map(x=>({...x,amount:wholeMoney(x.amount)}));
  n.expenses=(n.expenses||[]).map(x=>({...x,amount:wholeMoney(x.amount),recurring:x.recurring===undefined?true:!!x.recurring}));
  const before=(n.credits||[]).length;
  n.credits=(n.credits||[]).map(x=>({...x,totalAmount:wholeMoney(x.totalAmount)})).filter(cr=>!inactiveCreditExpired(cr));
  lastNormalizeRemovedCredits=Math.max(0,before-n.credits.length);
  return n;
}
function payloadFromState(snapshot,revision){const {_meta,...clean}=snapshot||{};return {_meta:{format:'kupa-portable',schemaVersion:6,revision,savedAt:new Date().toISOString(),app:'ניהול קופה ניידת'},...clean}}
function stateFromPayload(p){const {_meta,...raw}=p||{};if(!validState(raw))throw new Error('מבנה קובץ הנתונים אינו תקין');return {state:normalizeState(raw),meta:_meta||{}}}
function setSaveStatus(text,cls=''){
  const el=document.getElementById('saveIndicator');if(!el)return;
  const cloud=connectionMode==='supabase';
  el.hidden=cloud&&cls==='ok';
  el.textContent=text;
  el.className='save-indicator hide-mobile '+cls;
}
function setConnectedStatus(text='קובץ נתונים מחובר'){
  const st=document.getElementById('dbStatus');if(!st)return;
  const cloud=connectionMode==='supabase';
  st.hidden=cloud;
  st.className='file-status hide-mobile';
  st.innerHTML='<i></i> '+text;
}
function supaProjectRef(){try{return new URL(SUPA_CONFIG.url).hostname.split('.')[0]||'—'}catch(e){return '—'}}
function setCloudHeaderStatus(mode='off',text='ענן: לא מחובר'){const el=document.getElementById('cloudHeaderStatus');if(!el)return;el.className='cloud-head-status hide-mobile '+(mode||'');el.innerHTML='<i></i> '+text;el.title=`Supabase · project ${supaProjectRef()}`}
async function idbOpen(){return new Promise((resolve,reject)=>{try{const r=indexedDB.open('kupa-portable-handles',2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('handles'))db.createObjectStore('handles');if(!db.objectStoreNames.contains('sync'))db.createObjectStore('sync')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}catch(e){reject(e)}})}
async function idbPut(store,key,value){const db=await idbOpen();try{return await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('IndexedDB write aborted'))})}finally{db.close()}}
async function idbGet(store,key){const db=await idbOpen();try{return await new Promise((res,rej)=>{const tx=db.transaction(store,'readonly');const q=tx.objectStore(store).get(key);q.onsuccess=()=>res(q.result??null);q.onerror=()=>rej(q.error)})}finally{db.close()}}
async function idbDelete(store,key){const db=await idbOpen();try{return await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('IndexedDB delete aborted'))})}finally{db.close()}}
async function rememberHandle(handle){try{await idbPut('handles','root',handle)}catch(e){console.error('remember root handle',e)}}
async function getRememberedHandle(){try{return await idbGet('handles','root')}catch(e){return null}}
async function rememberBackupHandle(handle){try{await idbPut('handles','backup-root',handle)}catch(e){console.error('remember backup handle',e)}}
async function getRememberedBackupHandle(){try{return await idbGet('handles','backup-root')}catch(e){return null}}
const CLOUD_PENDING_KEY='cloud-pending-v2';
function comparePendingFreshness(a,b){const ag=Number(a?.generation||0),bg=Number(b?.generation||0);if(ag!==bg)return ag-bg;return (Date.parse(a?.savedAt||'')||0)-(Date.parse(b?.savedAt||'')||0)}
function loadCloudPendingSync(){try{const raw=localStorage.getItem(CLOUD_PENDING_LOCAL_KEY),pending=raw?JSON.parse(raw):null;if(pending)localGeneration=Math.max(localGeneration,Number(pending.generation||0));return pending}catch(e){console.error('pending local load',e);return null}}
function persistCloudPendingSync(p){try{const text=JSON.stringify(p);localStorage.setItem(CLOUD_PENDING_LOCAL_KEY,text);if(localStorage.getItem(CLOUD_PENDING_LOCAL_KEY)!==text)throw new Error('אימות pending מקומי נכשל');return true}catch(e){console.error('pending local save',e);return false}}
async function getCloudPending(){let local=loadCloudPendingSync(),idb=null;try{idb=await idbGet('sync',CLOUD_PENDING_KEY)}catch(e){console.error('pending idb load',e)}const chosen=!local?idb:!idb?local:(comparePendingFreshness(local,idb)>=0?local:idb);if(chosen){persistCloudPendingSync(chosen);try{await idbPut('sync',CLOUD_PENDING_KEY,chosen)}catch(e){console.error('pending idb repair',e)}}return chosen||null}
async function putCloudPending(p){const localOk=persistCloudPendingSync(p);try{await idbPut('sync',CLOUD_PENDING_KEY,p);return localOk}catch(e){console.error('pending idb save failed',e);return localOk}}
function cloudPendingExistsSync(){return !!loadCloudPendingSync()}
async function clearCloudPending(maxGeneration=Infinity){const current=await getCloudPending();if(current&&Number(current.generation||0)>Number(maxGeneration))return false;try{localStorage.removeItem(CLOUD_PENDING_LOCAL_KEY)}catch(e){}try{await idbDelete('sync',CLOUD_PENDING_KEY)}catch(e){}return true}
function browserStateRecord(snapshot=state,revision=dbRevision){return {schemaVersion:1,state:normalizeState(clone(snapshot)),revision:Number(revision||0),savedAt:new Date().toISOString()}}
function persistBrowserStateSync(record){try{const text=JSON.stringify(record);localStorage.setItem(BROWSER_STATE_KEY,text);if(localStorage.getItem(BROWSER_STATE_KEY)!==text)throw new Error('אימות עותק הדפדפן נכשל');return true}catch(e){console.error('browser state localStorage',e);return false}}
function loadBrowserStateSync(){try{const raw=localStorage.getItem(BROWSER_STATE_KEY);return raw?JSON.parse(raw):null}catch(e){console.error('browser state local load',e);return null}}
function queueBrowserStateIdb(record){browserStatePendingRecord=clone(record);if(browserStateWritePromise)return browserStateWritePromise;browserStateWritePromise=(async()=>{while(browserStatePendingRecord){const next=browserStatePendingRecord;browserStatePendingRecord=null;await idbPut('sync',BROWSER_STATE_IDB_KEY,next)}})().catch(e=>console.error('browser state idb',e)).finally(()=>{browserStateWritePromise=null;if(browserStatePendingRecord)queueBrowserStateIdb(browserStatePendingRecord)});return browserStateWritePromise}
function persistImmediateBrowserSnapshot(snapshot=state,revision=dbRevision){const record=browserStateRecord(snapshot,revision),ok=persistBrowserStateSync(record);queueBrowserStateIdb(record);return ok}
async function loadBrowserState(){const local=loadBrowserStateSync();let idb=null;try{idb=await idbGet('sync',BROWSER_STATE_IDB_KEY)}catch(e){console.error('browser state idb load',e)}const lt=Date.parse(local?.savedAt||'')||0,it=Date.parse(idb?.savedAt||'')||0;const chosen=it>lt?idb:local;if(chosen){persistBrowserStateSync(chosen);queueBrowserStateIdb(chosen)}return chosen||null}
async function requestPersistentBrowserStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){console.error('persistent storage request',e)}}
function lastSavedState(){try{return lastSavedSnapshot?normalizeState(JSON.parse(lastSavedSnapshot)):null}catch(e){return null}}
function lastSavedCloudState(){try{return lastSavedSnapshot?prepareKupaCloudState(JSON.parse(lastSavedSnapshot)):null}catch(e){return null}}
function loadSharedChecksBase(){try{const x=JSON.parse(localStorage.getItem(SHARED_CHECKS_BASE_KEY)||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('shared checks base load',e);return null}}
function loadSharedChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(SHARED_CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('shared checks events load',e);return[]}}
function persistSharedChecksBase(checks,events=sharedChecksBankEvents){try{localStorage.setItem(SHARED_CHECKS_BASE_KEY,JSON.stringify(normalizeSharedChecks(checks)));localStorage.setItem(SHARED_CHECKS_EVENTS_KEY,JSON.stringify(normalizeSharedBankEvents(events)));return true}catch(e){console.error('shared checks base save',e);return false}}
function markSharedChecksPending(){try{localStorage.setItem(SHARED_CHECKS_PENDING_KEY,JSON.stringify({pending:true,updatedAt:new Date().toISOString()}));return true}catch(e){console.error('shared checks pending',e);return false}}
function sharedChecksPendingExists(){return !!localStorage.getItem(SHARED_CHECKS_PENDING_KEY)}
function clearSharedChecksPending(){localStorage.removeItem(SHARED_CHECKS_PENDING_KEY)}
function sharedChecksHaveLocalWork(){return sharedChecksSaveRequested||sharedChecksPendingExists()||!!(sharedChecksBase&&!jsonEq(normalizeSharedChecks(state.checks),normalizeSharedChecks(sharedChecksBase)))}
function hasMeaningfulState(s){return ['checks','credits','cash','expenses','cards'].some(k=>Array.isArray(s?.[k])&&s[k].length)||s?.bank?.currentBalance!==null&&s?.bank?.currentBalance!==undefined||Array.isArray(s?.bank?.adjustments)&&s.bank.adjustments.length}
function showSecondaryTabGuard(){if(primaryTab)return;document.getElementById('connectScreen').style.display='flex';setConnectUI({title:'ניהול הקופה פתוח בלשונית אחרת',text:'כדי למנוע שתי כתיבות מקבילות לאותה קופה, רק לשונית אחת יכולה לערוך ולשמור.',note:'סגור את הלשונית האחרת או רענן את העמוד אחרי שסגרת אותה. הלשונית הזו לא תבצע שמירות כל עוד הנעילה תפוסה.'})}
async function acquirePrimaryTabLock(){if(!navigator.locks?.request){primaryTab=true;primaryTabReady=true;return true}let settled=false;return await new Promise(resolve=>{navigator.locks.request(TAB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){primaryTab=false;primaryTabReady=true;showSecondaryTabGuard();if(!settled){settled=true;resolve(false)}return}primaryTab=true;primaryTabReady=true;if(!settled){settled=true;resolve(true)}await new Promise(r=>{primaryLockRelease=r})}).catch(e=>{console.error('tab writer lock',e);primaryTab=true;primaryTabReady=true;if(!settled){settled=true;resolve(true)}})})}
async function openBrowserStateFallback(){const record=await loadBrowserState();if(!record?.state)return false;const pending=await getCloudPending(),full=normalizeState(clone(record.state));state=pending?.snapshot?applyKupaCloudState(pending.snapshot,full.checks):full;dbRevision=Number(pending?.baseRevision??record.revision??0);lastSavedSnapshot=JSON.stringify(pending?.baseState?prepareKupaCloudState(pending.baseState):prepareKupaCloudState(full));sharedChecksBase=loadSharedChecksBase();connectionMode='supabase';backendReady=true;document.getElementById('connectScreen').style.display='none';setConnectedStatus('Supabase — עותק מקומי');setSaveStatus(pending||sharedChecksPendingExists()?'אופליין — שינוי שמור מקומית וממתין':'אופליין — מוצג העותק המקומי האחרון','saving');setCloudHeaderStatus('offline','ענן: אופליין');render();startCloudPolling();return true}
async function permissionFor(handle){if(!handle)return false;let p=await handle.queryPermission?.({mode:'readwrite'});if(p==='granted')return true;p=await handle.requestPermission?.({mode:'readwrite'});return p==='granted'}
async function readJsonHandle(handle){const f=await handle.getFile();const txt=await f.text();return JSON.parse(txt)}
async function writeJsonHandle(handle,obj){const text=JSON.stringify(obj,null,2),writable=await handle.createWritable();await writable.write(text);await writable.close()}
async function writeJsonHandleVerified(handle,obj){await writeJsonHandle(handle,obj);const saved=await readJsonHandle(handle);if(comparableBackupPayload(saved)!==comparableBackupPayload(obj)||Number(saved?._meta?.revision||0)!==Number(obj?._meta?.revision||0))throw new Error('אימות תוכן קובץ הנתונים לאחר השמירה נכשל');return saved}
async function ensureDirectoryFile(root){const dataDir=await root.getDirectoryHandle('data',{create:true});backupRootDirHandle=root;backupsDirHandle=await root.getDirectoryHandle('backups',{create:true});let h;try{h=await dataDir.getFileHandle(DATA_FILE)}catch(e){if(e.name!=='NotFoundError')throw e;h=await dataDir.getFileHandle(DATA_FILE,{create:true});await writeJsonHandle(h,payloadFromState(normalizeState(clone(INITIAL_STATE)),1))}return h}
async function listBackups(){const arr=[];if(!backupsDirHandle)return arr;try{for await (const [name,h] of backupsDirHandle.entries()){if(h.kind==='file'&&name.endsWith('.json')&&name.startsWith(BACKUP_PREFIX)){const f=await h.getFile();arr.push({name,size:f.size,lastModified:f.lastModified})}}}catch(e){}arr.sort((a,b)=>b.lastModified-a.lastModified);return arr}
async function pruneAutomaticBackups(max=AUTO_BACKUP_KEEP){if(!backupsDirHandle)return;const arr=[];for await(const [name,h] of backupsDirHandle.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();arr.push({name,lastModified:f.lastModified})}arr.sort((a,b)=>b.lastModified-a.lastModified);for(const x of arr.slice(max)){try{await backupsDirHandle.removeEntry(x.name)}catch(e){console.error('backup prune',e)}}}
function backupTimestamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`}
function backupName(label=''){const safe=String(label||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');return `${BACKUP_PREFIX}${safe?safe+'_':''}${backupTimestamp()}.json`}
function comparableBackupPayload(payload){const {_meta,...raw}=payload||{};return JSON.stringify(raw)}
async function latestAutomaticBackup(){if(!backupsDirHandle)return null;let latest=null;for await(const [name,h] of backupsDirHandle.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();if(!latest||f.lastModified>latest.lastModified)latest={name,handle:h,file:f,lastModified:f.lastModified}}return latest}
async function writeVerifiedBackup(name,payload){if(!backupsDirHandle||!payload)return null;const h=await backupsDirHandle.getFileHandle(name,{create:true});await writeJsonHandle(h,payload);try{const saved=await readJsonHandle(h);if(comparableBackupPayload(saved)!==comparableBackupPayload(payload))throw new Error('אימות תוכן הגיבוי נכשל')}catch(e){try{await backupsDirHandle.removeEntry(name)}catch(ignore){}throw e}return name}
async function createManualBackup(payload,label=''){const name=backupName(label);await writeVerifiedBackup(name,payload);return name}
function clearPendingAutomaticBackup(){pendingAutoBackupPayload=null;if(autoBackupTimer){clearTimeout(autoBackupTimer);autoBackupTimer=null}}
function queueAutomaticBackup(payload,delay){pendingAutoBackupPayload=clone(payload);if(autoBackupTimer)return;autoBackupTimer=setTimeout(async()=>{autoBackupTimer=null;const pending=pendingAutoBackupPayload;pendingAutoBackupPayload=null;if(!pending)return;try{await maybeCreateAutomaticBackup(pending)}catch(e){console.error('scheduled automatic backup',e)}},Math.max(1000,delay))}
async function maybeCreateAutomaticBackup(payload){if(!backupsDirHandle||!payload)return null;const latest=await latestAutomaticBackup();let previous=null,valid=false;if(latest){try{previous=await readJsonHandle(latest.handle);valid=true}catch(e){console.error('backup validation',e)}}if(valid&&comparableBackupPayload(previous)===comparableBackupPayload(payload)){clearPendingAutomaticBackup();return null}if(latest&&valid){const remaining=AUTO_BACKUP_INTERVAL_MS-(Date.now()-latest.lastModified);if(remaining>0){queueAutomaticBackup(payload,remaining);return null}}const name=`${AUTO_BACKUP_PREFIX}${backupTimestamp()}.json`;await writeVerifiedBackup(name,payload);await pruneAutomaticBackups();clearPendingAutomaticBackup();return name}
async function backupSnapshotToComputer(snapshot=state,revision=dbRevision){if(!backupsDirHandle)return null;try{const name=await maybeCreateAutomaticBackup(payloadFromState(clone(snapshot),revision));serverInfo.backups=await listBackups();return name}catch(e){console.error('automatic local backup failed',e);return null}}
async function loadState(){if(!dataFileHandle)throw new Error('לא נבחר קובץ נתונים');const p=await readJsonHandle(dataFileHandle);const parsed=stateFromPayload(p);state=parsed.state;const removed=lastNormalizeRemovedCredits;dbRevision=Number(parsed.meta.revision||0);backendReady=true;localFileConflictPending=false;lastSavedSnapshot=JSON.stringify(state);serverInfo={schemaVersion:Number(parsed.meta.schemaVersion||6),lastSavedAt:parsed.meta.savedAt||null,databaseFile:dataFileHandle.name,backups:await listBackups()};persistImmediateBrowserSnapshot(state,dbRevision);if(backupsDirHandle)await backupSnapshotToComputer(state,dbRevision);setConnectedStatus(connectionMode==='directory'?'תיקיית קופה מחוברת':'קובץ נתונים מחובר');setSaveStatus('נשמר בקובץ','ok');if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} עסקאות אשראי ישנות ולא פעילות`),0);return state}
function saveState(msg='נשמר'){
  if(!primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  const fullSnapshot=normalizeState(clone(state)),generation=++localGeneration,snapshot=connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot):fullSnapshot;
  const localOk=persistImmediateBrowserSnapshot(fullSnapshot,dbRevision);
  if(!localOk)setSaveStatus('שגיאת עותק מקומי','error');
  if(connectionMode==='supabase'&&backendReady)stageCloudPendingLocal(snapshot,msg,dbRevision,lastSavedCloudState()||snapshot,generation,false);
  saveQueue=saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation));
  return saveQueue
}
function saveChecksState(msg='הצק נשמר'){
  if(!primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  if(connectionMode!=='supabase'||!backendReady)return saveState(msg);
  const fullSnapshot=normalizeState(clone(state)),localOk=persistImmediateBrowserSnapshot(fullSnapshot,dbRevision);
  sharedChecksGeneration++;sharedChecksSaveRequested=true;markSharedChecksPending();
  if(!localOk)setSaveStatus('שגיאת עותק מקומי','error');else setSaveStatus(navigator.onLine?'צקים ממתינים לסנכרון':'אופליין — הצקים שמורים מקומית','saving');
  if(backupsDirHandle)backupSnapshotToComputer(fullSnapshot,dbRevision).catch(e=>console.error('shared checks local backup',e));
  clearTimeout(sharedChecksSaveTimer);sharedChecksSaveTimer=setTimeout(()=>{sharedChecksSaveTimer=null;saveSharedChecksToCloud(msg)},220);
  render();return Promise.resolve(localOk)
}
async function persistState(snapshot,msg,generation=localGeneration){
  if(!backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===localGeneration)snapshot=connectionMode==='supabase'?prepareKupaCloudState(state):normalizeState(clone(state));
  if(connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  if(!dataFileHandle){setSaveStatus('אין קובץ נתונים','error');return false}
  if(localFileConflictPending){persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');return false}
  setSaveStatus(generation===localGeneration?'שומר…':'שומר תור שינויים…','saving');
  try{
    const current=await readJsonHandle(dataFileHandle),curMeta=current?._meta||{},curRev=Number(curMeta.revision||0),remote=stateFromPayload(current).state;
    let candidate=clone(snapshot),expected=curRev;
    if(curRev!==dbRevision){
      const base=lastSavedState();
      if(!base){localFileConflictPending=true;persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('קובץ השתנה — נדרשת בדיקה','error');alert('קובץ הנתונים השתנה ולא קיימת גרסת בסיס בטוחה למיזוג. השינויים שעל המסך נשמרו בעותק הדפדפן ולא נדרסו. מומלץ לייצא JSON ולפתוח מחדש את הקופה.');return false}
      const merged=mergeState3Way(base,snapshot,remote);
      if(merged.conflicts.length){localFileConflictPending=true;persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');alert('אותה רשומה שונתה גם בקובץ וגם במסך הזה. כדי למנוע דריסה השמירה לקובץ נעצרה; השינויים המקומיים נשמרו בעותק הדפדפן. ייצא גיבוי JSON ופתח מחדש את הקופה לפני המשך עריכה.');return false}
      candidate=merged.state;
    }
    const nextRev=expected+1,payload=payloadFromState(candidate,nextRev);
    await writeJsonHandleVerified(dataFileHandle,payload);
    dbRevision=nextRev;lastSavedSnapshot=JSON.stringify(candidate);serverInfo.lastSavedAt=payload._meta.savedAt;
    if(generation===localGeneration){state=normalizeState(clone(candidate))}else{
      const rebased=mergeState3Way(snapshot,state,candidate);
      if(rebased.conflicts.length){localFileConflictPending=true;setSaveStatus('שינוי נוסף התנגש — נשמר בדפדפן','error')}else state=rebased.state
    }
    persistImmediateBrowserSnapshot(state,dbRevision);
    if(backupsDirHandle)await backupSnapshotToComputer(candidate,nextRev);serverInfo.backups=await listBackups();
    if(generation===localGeneration&&!localFileConflictPending){setSaveStatus('נשמר בקובץ','ok');toast(msg);render()}else if(!localFileConflictPending)setSaveStatus('שומר שינוי נוסף…','saving');
    return !localFileConflictPending
  }catch(e){console.error(e);persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('שגיאת שמירה — העותק המקומי שמור','error');alert('השמירה לקובץ נכשלה. השינוי נשמר בעותק התאוששות בדפדפן ולא יידרס בלי אזהרה. מומלץ לייצא גיבוי JSON ולטפל בגישה לתיקייה.');return false}
}
async function connectDirectory(handle){if(!primaryTab){showSecondaryTabGuard();return}if(!await permissionFor(handle))throw new Error('לא ניתנה הרשאת קריאה וכתיבה');rootDirHandle=handle;backupRootDirHandle=handle;connectionMode='directory';localStorage.setItem(STORAGE_PREF_KEY,'directory');dataFileHandle=await ensureDirectoryFile(handle);await rememberHandle(handle);await rememberBackupHandle(handle);await loadState();document.getElementById('connectScreen').style.display='none';render()}
async function chooseFolder(){try{if(!window.showDirectoryPicker)throw new Error('DIRECTORY_UNSUPPORTED');const h=await window.showDirectoryPicker({id:'kupa-main-folder',mode:'readwrite'});await connectDirectory(h)}catch(e){if(e.name==='AbortError')return;if(e.message==='DIRECTORY_UNSUPPORTED'){document.getElementById('chooseDataFile').style.display='inline-block';document.getElementById('connectNote').innerHTML='<b>הדפדפן לא מאפשר בחירת תיקייה.</b><br>אפשר לבחור ישירות את קובץ הנתונים; לשימוש מלא מומלץ Chrome או Edge עדכני.';return}console.error(e);alert('לא ניתן לפתוח את התיקייה: '+e.message)}}
async function connectDataFile(handle){if(!primaryTab){showSecondaryTabGuard();return}if(!await permissionFor(handle))throw new Error('לא ניתנה הרשאת כתיבה');rootDirHandle=null;backupsDirHandle=null;connectionMode='file';localStorage.setItem(STORAGE_PREF_KEY,'file');dataFileHandle=handle;await loadState();document.getElementById('connectScreen').style.display='none';render()}
async function chooseDataFile(){try{if(window.showOpenFilePicker){const [h]=await window.showOpenFilePicker({id:'kupa-data-file',types:[{description:'קובץ נתוני קופה',accept:{'application/json':['.json']}}],multiple:false});await connectDataFile(h)}else{document.getElementById('legacyFileInput').click()}}catch(e){if(e.name!=='AbortError')alert('לא ניתן לפתוח את הקובץ: '+e.message)}}
async function chooseBackupFolder(){try{if(!window.showDirectoryPicker)throw new Error('הדפדפן אינו תומך בבחירת תיקיית גיבוי');const h=await window.showDirectoryPicker({id:'kupa-backup-folder',mode:'readwrite'});if(!await permissionFor(h))throw new Error('לא ניתנה הרשאת כתיבה');backupRootDirHandle=h;backupsDirHandle=await h.getDirectoryHandle('backups',{create:true});await rememberBackupHandle(h);serverInfo.backups=await listBackups();await backupSnapshotToComputer();toast('תיקיית הגיבוי המקומית חוברה');if(currentPage==='settings')renderSettings()}catch(e){if(e.name!=='AbortError'){console.error(e);alert('לא ניתן לחבר תיקיית גיבוי: '+e.message)}}}
async function restoreRememberedBackupTarget(){try{const h=await getRememberedBackupHandle()||await getRememberedHandle();if(!h)return false;const p=await h.queryPermission?.({mode:'readwrite'});if(p!=='granted')return false;backupRootDirHandle=h;backupsDirHandle=await h.getDirectoryHandle('backups',{create:true});serverInfo.backups=await listBackups();return true}catch(e){console.error('restore backup target',e);return false}}

function supaConfigured(){return !!(SUPA_CONFIG.url&&SUPA_CONFIG.publishableKey)}
function loadSupaSession(){if(supaSession)return supaSession;try{supaSession=JSON.parse(localStorage.getItem(SUPA_SESSION_KEY)||'null')}catch(e){supaSession=null}return supaSession}
async function restoreSupaSession(){let s=loadSupaSession();if(s)return s;try{s=await idbGet('sync',SUPA_SESSION_IDB_KEY);if(s){supaSession=s;try{localStorage.setItem(SUPA_SESSION_KEY,JSON.stringify(s))}catch(e){}}}catch(e){}return s||null}
function storeSupaSession(s){supaSession=s||null;try{if(s)localStorage.setItem(SUPA_SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SUPA_SESSION_KEY)}catch(e){};if(s)idbPut('sync',SUPA_SESSION_IDB_KEY,s).catch(()=>{});else idbDelete('sync',SUPA_SESSION_IDB_KEY).catch(()=>{})} 
function isSupabaseAuthError(e){const m=String(e?.message||e||'').toLowerCase();return m.includes('invalid login credentials')||m.includes('invalid_credentials')||m.includes('jwt')||m.includes('refresh token')||m.includes('פג תוקף')||m.includes('נדרשת התחברות')}
function friendlySupabaseError(e){const m=String(e?.message||e||'');if(/invalid login credentials|invalid_credentials/i.test(m))return `האימייל או הסיסמה אינם תקינים עבור פרויקט Supabase שמוגדר במערכת (${supaProjectRef()}).`;if(/email not confirmed/i.test(m))return 'חשבון Supabase קיים אך האימייל עדיין לא אושר.';if(/failed to fetch|networkerror|load failed/i.test(m))return 'לא ניתן להגיע כרגע ל-Supabase. בדוק חיבור אינטרנט ונסה שוב.';return m||'שגיאת Supabase'}
function supaBaseHeaders(token){const h={'apikey':SUPA_CONFIG.publishableKey,'Content-Type':'application/json'};if(token)h.Authorization=`Bearer ${token}`;return h}
async function supaAuthPassword(email,password){
  if(!supaConfigured())throw new Error('הגדרת Supabase חסרה');
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({email,password})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error_description||j?.msg||j?.message||'התחברות Supabase נכשלה');
  j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);storeSupaSession(j);localStorage.setItem(SUPA_EMAIL_KEY,email);localStorage.setItem(SUPA_AUTO_KEY,'1');cloudAuthNoDocument=false;setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j
}
async function supaRefresh(){
  const s=loadSupaSession();if(!s?.refresh_token)throw new Error('נדרשת התחברות מחדש לענן');
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})});
  const j=await r.json().catch(()=>({}));if(!r.ok){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');throw new Error('פג תוקף ההתחברות לענן')};j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);storeSupaSession(j);setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j
}
async function supaEnsureSession(){let s=loadSupaSession();if(!s)throw new Error('נדרשת התחברות לענן');if(Number(s.expires_at||0)<=Math.floor(Date.now()/1000)+60)s=await supaRefresh();return s}
async function supaRest(path,options={}){
  let s=await supaEnsureSession(),r=await fetch(`${SUPA_CONFIG.url}${path}`,{...options,headers:{...supaBaseHeaders(s.access_token),...(options.headers||{})}});
  if(r.status===401){s=await supaRefresh();r=await fetch(`${SUPA_CONFIG.url}${path}`,{...options,headers:{...supaBaseHeaders(s.access_token),...(options.headers||{})}})}
  return r
}
async function readSupabaseDocument(){
  const q=`/rest/v1/kupa_documents?document_name=eq.${encodeURIComponent(cloudDocumentName)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת הקופה מהענן נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){
    assertValidCloudState(row.state,'מסמך הקופה בענן');
    const rev=Number(row.revision);
    if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הקופה בענן אינו תקין. הסנכרון נעצר כדי למנוע דריסה.');
  }
  return row
}
async function readSharedChecksDocument(){
  const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת מאגר הצקים המשותף נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){if(!row.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('מסמך הצקים המשותף בענן במבנה לא תקין');const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הצקים המשותף אינו תקין')}
  return row
}
async function readSharedChecksMeta(){
  const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הצקים המשותפים נכשלה');return Array.isArray(j)&&j.length?j[0]:null
}
async function rpcSaveSharedChecks(checks,expectedRevision){
  const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0);if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצקים המקומי אינו תקין');
  const r=await supaRest(`/rest/v1/rpc/${SHARED_CHECKS_RPC}`,{method:'POST',body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload})});const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j}
}
function mergeSharedChecks(base,local,remote,{preferLocalConflicts=false}={}){
  const b=normalizeSharedChecks(base||[]),l=normalizeSharedChecks(local||[]),r=normalizeSharedChecks(remote||[]);
  const repairEmptyBootstrap=sharedChecksBootstrapActive&&!l.length&&r.length>0&&b.length>0&&jsonEq(b,r);
  sharedChecksBootstrapActive=false;
  if(repairEmptyBootstrap)return {checks:clone(r),conflicts:[],repairedEmptyBootstrap:true};
  const conflicts=[];let checks=mergeRecordArray(b,l,r,'id','checks',conflicts);if(preferLocalConflicts&&conflicts.length){checks=mergeRecordArrayPreferLocal(b,l,r,'id')}return {checks:normalizeSharedChecks(checks),conflicts,repairedEmptyBootstrap:false}
}
async function syncSharedChecksFromCloud({quiet=false,required=false}={}){
  if(!navigator.onLine)return false;if(sharedChecksBusy)return false;sharedChecksBusy=true;
  try{const row=await readSharedChecksDocument();if(!row){sharedChecksLastError='מאגר הצקים המשותף עדיין לא נוצר';if(required)throw new Error('מאגר הצקים המשותף חסר. יש להריץ את מיגרציית ה-cutover לפני העלאת הגרסה החדשה.');return false}const remote=normalizeSharedChecks(row.state.checks),local=normalizeSharedChecks(state.checks);if(!sharedChecksBase&&local.length&&!jsonEq(local,remote)){sharedChecksLastError='נמצאו צקים מקומיים ללא גרסת בסיס והם שונים מהענן';markSharedChecksPending();const err=new Error('נמצאו צקים מקומיים שלא ניתן להוכיח שסונכרנו לפני המעבר. הנתונים המקומיים נשמרו ולא נדרסו. יש לבדוק אותם לפני המשך.');if(required)throw err;if(!quiet)toast(err.message);return false}const base=sharedChecksBase?clone(sharedChecksBase):clone(local),merged=mergeSharedChecks(base,local,remote);if(merged.conflicts.length){sharedChecksLastError='אותו צק שונה במקביל בשני מקומות';markSharedChecksPending();const err=new Error('הצקים לא נדרסו: נמצאה עריכה מקבילה של אותו צק.');if(required)throw err;if(!quiet)toast(err.message);return false}state.checks=clone(merged.checks);sharedChecksBase=clone(remote);sharedChecksBankEvents=normalizeSharedBankEvents(row.state.bankEvents);persistSharedChecksBase(sharedChecksBase,sharedChecksBankEvents);sharedChecksRevision=Number(row.revision||0);sharedChecksLastError='';persistImmediateBrowserSnapshot(state,dbRevision);if(!jsonEq(merged.checks,remote)){sharedChecksSaveRequested=true;markSharedChecksPending();setTimeout(()=>saveSharedChecksToCloud('שינויי הצקים המקומיים מוזגו לענן'),0)}else{sharedChecksSaveRequested=false;clearSharedChecksPending()}if(!quiet)render();return true}catch(e){console.error('shared checks pull',e);sharedChecksLastError=e.message||String(e);if(required)throw e;return false}finally{sharedChecksBusy=false}}
async function ensureSharedChecksForNewCloud(message='מאגר הצקים המשותף נוצר וסונכרן'){
  let row=await readSharedChecksDocument();
  if(row){await syncSharedChecksFromCloud({quiet:true,required:true});return true}
  const local=normalizeSharedChecks(state.checks);
  let res=await rpcSaveSharedChecks(local,0);
  if(!res.r.ok){
    const em=res.j?.message||res.body||'יצירת מאגר הצקים המשותף נכשלה';
    if(String(em).includes('revision_conflict')){await syncSharedChecksFromCloud({quiet:true,required:true});return true}
    throw new Error(em)
  }
  row=res.row;
  if(!row?.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('שרת הצקים החזיר מסמך לא תקין לאחר יצירה');
  state.checks=normalizeSharedChecks(row.state.checks);
  sharedChecksBase=clone(state.checks);
  sharedChecksBankEvents=normalizeSharedBankEvents(row.state.bankEvents);
  sharedChecksRevision=Number(row.revision||1);
  sharedChecksLastError='';sharedChecksSaveRequested=false;
  persistSharedChecksBase(sharedChecksBase,sharedChecksBankEvents);clearSharedChecksPending();
  persistImmediateBrowserSnapshot(state,dbRevision);
  if(message)toast(message);
  return true
}
async function saveSharedChecksToCloud(message='הצקים סונכרנו'){
  if(!primaryTab)return false;sharedChecksSaveRequested=true;if(!backendReady||connectionMode!=='supabase'||!navigator.onLine){markSharedChecksPending();return false}if(sharedChecksBusy)return sharedChecksSavePromise||false;if(sharedChecksSavePromise)return sharedChecksSavePromise;
  clearTimeout(sharedChecksSaveTimer);sharedChecksSaveTimer=null;
  sharedChecksSavePromise=(async()=>{let allOk=true;while(sharedChecksSaveRequested&&navigator.onLine&&connectionMode==='supabase'){sharedChecksSaveRequested=false;const startGeneration=sharedChecksGeneration,local=normalizeSharedChecks(state.checks),base=sharedChecksBase?clone(sharedChecksBase):clone(local);sharedChecksBusy=true;try{let saved=null,savedRevision=sharedChecksRevision;for(let attempt=0;attempt<3;attempt++){const row=await readSharedChecksDocument();if(!row)throw new Error('מאגר הצקים המשותף חסר. אין ליצור אותו אוטומטית; יש להשלים cutover תקין.');const remote=normalizeSharedChecks(row.state.checks);if(!sharedChecksBase&&local.length&&!jsonEq(local,remote)){sharedChecksLastError='נמצאו צקים מקומיים ללא גרסת בסיס והם שונים מהענן';markSharedChecksPending();setSaveStatus('צקים מקומיים דורשים בדיקה — לא בוצעה דריסה','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקת צקים');allOk=false;break}const merged=mergeSharedChecks(base,local,remote);if(merged.conflicts.length){sharedChecksLastError='אותו צק שונה במקביל בשני מקומות';markSharedChecksPending();setSaveStatus('התנגשות בצקים — השינוי המקומי שמור','error');setCloudHeaderStatus('conflict','ענן: התנגשות בצקים');allOk=false;break}const res=await rpcSaveSharedChecks(merged.checks,Number(row.revision||0));if(!res.r.ok){const em=res.j?.message||res.body||'שמירת הצקים המשותפים נכשלה';if(String(em).includes('revision_conflict'))continue;throw new Error(em)}saved=normalizeSharedChecks(res.row?.state?.checks||merged.checks);sharedChecksBankEvents=normalizeSharedBankEvents(res.row?.state?.bankEvents||row.state.bankEvents);savedRevision=Number(res.row?.revision||Number(row.revision||0)+1);break}if(!saved){allOk=false;markSharedChecksPending();break}sharedChecksBase=clone(saved);persistSharedChecksBase(saved,sharedChecksBankEvents);sharedChecksRevision=savedRevision;sharedChecksLastError='';if(sharedChecksGeneration===startGeneration){state.checks=clone(saved);clearSharedChecksPending()}else{const rebased=mergeSharedChecks(base,normalizeSharedChecks(state.checks),saved,{preferLocalConflicts:true});state.checks=clone(rebased.checks);markSharedChecksPending();sharedChecksSaveRequested=true}persistImmediateBrowserSnapshot(state,dbRevision);if(backupsDirHandle)await backupSnapshotToComputer(state,dbRevision);if(!sharedChecksSaveRequested&&!sharedChecksPendingExists()){setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');if(message)toast(message)}render()}catch(e){console.error('shared checks save',e);sharedChecksLastError=e.message||String(e);markSharedChecksPending();setSaveStatus(navigator.onLine?'צקים ממתינים לסנכרון':'אופליין — הצקים שמורים מקומית','saving');allOk=false;break}finally{sharedChecksBusy=false}}return allOk&&!sharedChecksPendingExists()})().finally(()=>{sharedChecksSavePromise=null;if(sharedChecksSaveRequested&&navigator.onLine&&!sharedChecksBusy)setTimeout(()=>saveSharedChecksToCloud(message),0)});return sharedChecksSavePromise
}
async function pollSharedChecks(){if(!primaryTab||connectionMode!=='supabase'||!backendReady||!navigator.onLine||sharedChecksBusy)return;if(sharedChecksHaveLocalWork()){await saveSharedChecksToCloud('שינויי הצקים סונכרנו');return}sharedChecksBusy=true;try{const meta=await readSharedChecksMeta();if(!meta)return;const rev=Number(meta.revision||0);if(rev>sharedChecksRevision){const row=await readSharedChecksDocument();if(!row||Number(row.revision||0)<=sharedChecksRevision)return;const remote=normalizeSharedChecks(row.state.checks);state.checks=clone(remote);sharedChecksBase=clone(remote);sharedChecksBankEvents=normalizeSharedBankEvents(row.state.bankEvents);persistSharedChecksBase(remote,sharedChecksBankEvents);sharedChecksRevision=Number(row.revision||0);sharedChecksLastError='';clearSharedChecksPending();persistImmediateBrowserSnapshot(state,dbRevision);if(backupsDirHandle)await backupSnapshotToComputer(state,dbRevision);render();toast('התקבל עדכון צקים ממקור אחר')}}catch(e){console.error('shared checks poll',e);sharedChecksLastError=e.message||String(e)}finally{sharedChecksBusy=false;if(sharedChecksSaveRequested)setTimeout(()=>saveSharedChecksToCloud(),0)}}
function jsonEq(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}
function mergeRecordArray(baseArr,localArr,remoteArr,keyName,path,conflicts){
  const keyOf=x=>String(x?.[keyName]??'');
  const bm=new Map((baseArr||[]).map(x=>[keyOf(x),x])),lm=new Map((localArr||[]).map(x=>[keyOf(x),x])),rm=new Map((remoteArr||[]).map(x=>[keyOf(x),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    const b=bm.has(k)?bm.get(k):undefined,l=lm.has(k)?lm.get(k):undefined,r=rm.has(k)?rm.get(k):undefined;
    const lc=!jsonEq(l,b),rc=!jsonEq(r,b);
    if(lc&&rc&&!jsonEq(l,r)){conflicts.push(`${path}:${k}`);continue}
    const chosen=lc?l:r;
    if(chosen!==undefined)out.push(clone(chosen));
  }
  return out;
}
function mergeValue(base,local,remote,path,conflicts){const lc=!jsonEq(local,base),rc=!jsonEq(remote,base);if(lc&&rc&&!jsonEq(local,remote)){conflicts.push(path);return clone(remote)}return clone(lc?local:remote)}
function mergeState3Way(base,local,remote){
  base=base||{};local=local||{};remote=remote||{};const conflicts=[];const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValue(base.businessName,local.businessName,remote.businessName,'businessName',conflicts);
  out.checks=mergeRecordArray(base.checks,local.checks,remote.checks,'id','checks',conflicts);
  out.credits=mergeRecordArray(base.credits,local.credits,remote.credits,'id','credits',conflicts);
  out.cash=mergeRecordArray(base.cash,local.cash,remote.cash,'id','cash',conflicts);
  out.expenses=mergeRecordArray(base.expenses,local.expenses,remote.expenses,'id','expenses',conflicts);
  out.cards=mergeRecordArray(base.cards,local.cards,remote.cards,'name','cards',conflicts);
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={
    currentBalance:mergeValue(bb.currentBalance,lb.currentBalance,rb.currentBalance,'bank.currentBalance',conflicts),
    updatedAt:mergeValue(bb.updatedAt,lb.updatedAt,rb.updatedAt,'bank.updatedAt',conflicts),
    asOfDate:mergeValue(bb.asOfDate,lb.asOfDate,rb.asOfDate,'bank.asOfDate',conflicts),
    snapshotToken:mergeValue(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken,'bank.snapshotToken',conflicts),
    snapshotSeq:mergeValue(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq,'bank.snapshotSeq',conflicts),
    adjustments:mergeRecordArray(bb.adjustments,lb.adjustments,rb.adjustments,'id','bank.adjustments',conflicts)
  };
  return {state:normalizeState(out),conflicts};
}
function mergeRecordArrayPreferLocal(baseArr,localArr,remoteArr,keyName){
  const keyOf=x=>String(x?.[keyName]??'');
  const bm=new Map((baseArr||[]).map(x=>[keyOf(x),x])),lm=new Map((localArr||[]).map(x=>[keyOf(x),x])),rm=new Map((remoteArr||[]).map(x=>[keyOf(x),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    const b=bm.has(k)?bm.get(k):undefined,l=lm.has(k)?lm.get(k):undefined,r=rm.has(k)?rm.get(k):undefined;
    const localChanged=!jsonEq(l,b),chosen=localChanged?l:r;
    if(chosen!==undefined)out.push(clone(chosen));
  }
  return out;
}
function mergeValuePreferLocal(base,local,remote){return clone(!jsonEq(local,base)?local:remote)}
function rebaseLocalProgress(base,local,remote){
  base=base||{};local=local||{};remote=remote||{};const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValuePreferLocal(base.businessName,local.businessName,remote.businessName);
  out.checks=mergeRecordArrayPreferLocal(base.checks,local.checks,remote.checks,'id');
  out.credits=mergeRecordArrayPreferLocal(base.credits,local.credits,remote.credits,'id');
  out.cash=mergeRecordArrayPreferLocal(base.cash,local.cash,remote.cash,'id');
  out.expenses=mergeRecordArrayPreferLocal(base.expenses,local.expenses,remote.expenses,'id');
  out.cards=mergeRecordArrayPreferLocal(base.cards,local.cards,remote.cards,'name');
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={
    currentBalance:mergeValuePreferLocal(bb.currentBalance,lb.currentBalance,rb.currentBalance),
    updatedAt:mergeValuePreferLocal(bb.updatedAt,lb.updatedAt,rb.updatedAt),
    asOfDate:mergeValuePreferLocal(bb.asOfDate,lb.asOfDate,rb.asOfDate),
    snapshotToken:mergeValuePreferLocal(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken),
    snapshotSeq:mergeValuePreferLocal(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq),
    adjustments:mergeRecordArrayPreferLocal(bb.adjustments,lb.adjustments,rb.adjustments,'id')
  };
  return normalizeState(out);
}
function mergeKupaCloudState3Way(base,local,remote){const merged=mergeState3Way({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]});return {state:prepareKupaCloudState(merged.state),conflicts:merged.conflicts.filter(x=>!String(x).startsWith('checks:'))}}
function rebaseKupaCloudProgress(base,local,remote){return prepareKupaCloudState(rebaseLocalProgress({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]}))}
function stageCloudPendingLocal(snapshot,msg,baseRevision=dbRevision,baseState=null,generation=localGeneration,conflict=false){
  const existing=loadCloudPendingSync(),base=existing?.baseState||baseState||lastSavedCloudState()||prepareKupaCloudState(snapshot),record={schemaVersion:2,id:existing?.id||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,documentName:cloudDocumentName,generation:Math.max(Number(generation||0),Number(existing?.generation||0)),baseRevision:Number(existing?.baseRevision??baseRevision??0),baseState:clone(base),snapshot:clone(snapshot),msg:msg||existing?.msg||'שינויים ממתינים',savedAt:new Date().toISOString(),conflict:!!(conflict||existing?.conflict)};
  persistCloudPendingSync(record);putCloudPending(record).catch(e=>console.error('pending mirror',e));cloudConflictPending=record.conflict;
  setSaveStatus(record.conflict?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');
  setCloudHeaderStatus(record.conflict?'conflict':navigator.onLine?'syncing':'offline',record.conflict?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return record
}
async function rebaseNewerPending(completedGeneration,baseState,newRevision){const pending=await getCloudPending();if(!pending||Number(pending.generation||0)<=Number(completedGeneration||0))return false;const nextSnapshot=rebaseKupaCloudProgress(pending.baseState||baseState,pending.snapshot,baseState);const next={...pending,baseRevision:Number(newRevision||0),baseState:prepareKupaCloudState(baseState),snapshot:clone(nextSnapshot),savedAt:new Date().toISOString(),conflict:!!pending.conflict};await putCloudPending(next);cloudConflictPending=next.conflict;return true}
async function applyCloudRow(row,{renderNow=true}={}){
  const localChecks=normalizeSharedChecks(state.checks);state=applyKupaCloudState(row.state,localChecks);const removed=lastNormalizeRemovedCredits;dbRevision=Number(row.revision||0);connectionMode='supabase';backendReady=true;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));serverInfo={schemaVersion:6,lastSavedAt:row.updated_at||null,databaseFile:'Supabase',backups:await listBackups()};sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});persistImmediateBrowserSnapshot(state,dbRevision);await backupSnapshotToComputer(state,dbRevision);localStorage.setItem(STORAGE_PREF_KEY,'supabase');setConnectedStatus('Supabase מחובר');setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');cloudAuthNoDocument=false;localStorage.setItem(SUPA_AUTO_KEY,'1');document.getElementById('connectScreen').style.display='none';cloudConflictPending=false;if(renderNow)render();if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} עסקאות אשראי ישנות ולא פעילות`),0);startCloudPolling();return state
}
async function loadSupabaseState(){
  const row=await readSupabaseDocument();if(!row)throw new Error('עדיין לא קיימת קופה בענן. פתח את הקופה המקומית והעלה אותה לענן מתוך הגדרות.');
  const pending=await getCloudPending();
  if(pending){connectionMode='supabase';backendReady=true;document.getElementById('connectScreen').style.display='none';dbRevision=Number(row.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);return state}
  return applyCloudRow(row)
}
async function rpcSaveCloud(snapshot,expectedRevision){
  assertValidCloudState(snapshot,'הנתונים המקומיים');
  const expected=Number(expectedRevision||0);
  if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision מקומי אינו תקין. השמירה לענן נעצרה.');
  const r=await supaRest('/rest/v1/rpc/save_kupa_document',{method:'POST',body:JSON.stringify({p_document_name:cloudDocumentName,p_expected_revision:expected,p_state:snapshot})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}
  return {r,j,body,row:Array.isArray(j)?j[0]:j};
}
async function reconcileCloudPending(remoteRow=null){
  if(cloudSyncBusy||cloudWriteBusy)return false;cloudSyncBusy=true;
  try{
    let pending=await getCloudPending();if(!pending){cloudConflictPending=false;return false}
    state=applyKupaCloudState(pending.snapshot,state.checks);persistImmediateBrowserSnapshot(state,pending.baseRevision||dbRevision);
    if(pending.conflict){cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();return false}
    if(!navigator.onLine){cloudConflictPending=false;setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין');return false}
    let row=remoteRow||await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');
    for(let attempt=0;attempt<3;attempt++){
      pending=await getCloudPending();if(!pending)return true;if(pending.conflict){cloudConflictPending=true;return false}
      let candidate=prepareKupaCloudState(pending.snapshot),expected=Number(row.revision||0);
      if(Number(row.revision||0)!==Number(pending.baseRevision||0)){
        const merged=mergeKupaCloudState3Way(pending.baseState,pending.snapshot,row.state);
        if(merged.conflicts.length){const conflicted={...pending,conflict:true,savedAt:new Date().toISOString()};await putCloudPending(conflicted);cloudConflictPending=true;state=applyKupaCloudState(pending.snapshot,state.checks);dbRevision=Number(row.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));persistImmediateBrowserSnapshot(state,dbRevision);setConnectedStatus('Supabase — נדרשת הכרעה');setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();alert('יש התנגשות אמיתית: אותה רשומה שונתה גם במחשב הזה וגם במקור אחר. השינוי המקומי נשמר ולא נדרס. ייצא גיבוי JSON ובדוק את הרשומה לפני המשך הסנכרון.');return false}
        candidate=merged.state
      }
      cloudWriteBusy=true;const res=await rpcSaveCloud(candidate,expected);cloudWriteBusy=false;
      if(!res.r.ok){const em=res.j?.message||res.body||'שמירה לענן נכשלה';if(String(em).includes('revision_conflict')){row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן נעלם בזמן הסנכרון');continue}throw new Error(em)}
      const completedGeneration=Number(pending.generation||0),newRev=Number(res.row?.revision||expected+1),authoritative=prepareKupaCloudState(res.row?.state||candidate);dbRevision=newRev;lastSavedSnapshot=JSON.stringify(authoritative);serverInfo.lastSavedAt=res.row?.updated_at||new Date().toISOString();cloudConflictPending=false;
      const newer=await rebaseNewerPending(completedGeneration,authoritative,newRev);
      if(!newer){await clearCloudPending(completedGeneration);state=applyKupaCloudState(authoritative,state.checks);setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן')}else{const newest=await getCloudPending();state=applyKupaCloudState(newest?.snapshot||state,state.checks);setSaveStatus(newest?.conflict?'התנגשות שמורה מקומית':'ממתין לשינוי הבא…',newest?.conflict?'error':'saving');setCloudHeaderStatus(newest?.conflict?'conflict':'syncing',newest?.conflict?'ענן: התנגשות':'ענן: מסנכרן…')}
      persistImmediateBrowserSnapshot(state,dbRevision);await backupSnapshotToComputer(state,dbRevision);render();if(newer&&!cloudConflictPending)setTimeout(cloudPoll,0);return !cloudConflictPending
    }
    throw new Error('הענן השתנה שוב ושוב בזמן הסנכרון; השינוי המקומי נשמר וינוסה שוב')
  }catch(e){cloudWriteBusy=false;console.error(e);cloudConflictPending=!!loadCloudPendingSync()?.conflict;setSaveStatus(cloudConflictPending?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(cloudConflictPending?'conflict':navigator.onLine?'syncing':'offline',cloudConflictPending?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return false}finally{cloudSyncBusy=false}
}
async function persistSupabaseState(snapshot,msg,generation=localGeneration){
  if(!primaryTab){showSecondaryTabGuard();return false}
  let pending=await getCloudPending();
  if(pending&&Number(pending.generation||0)>=Number(generation||0))snapshot=prepareKupaCloudState(pending.snapshot);
  if(pending?.conflict||cloudConflictPending){stageCloudPendingLocal(snapshot,msg,pending?.baseRevision??dbRevision,pending?.baseState||lastSavedCloudState()||snapshot,Math.max(generation,Number(pending?.generation||0)),true);persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  pending=stageCloudPendingLocal(snapshot,msg,dbRevision,lastSavedCloudState()||snapshot,generation,false);
  if(!navigator.onLine){cloudConflictPending=false;persistImmediateBrowserSnapshot(state,dbRevision);toast('אין רשת — השינוי נשמר מקומית ויעלה אוטומטית בחיבור הבא');return false}
  if(cloudSyncBusy){setSaveStatus('ממתין למחזור סנכרון פעיל…','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
  cloudSyncBusy=true;
  setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
  try{
    let baseRevision=dbRevision,baseState=lastSavedCloudState()||pending.baseState||prepareKupaCloudState(snapshot),candidate=prepareKupaCloudState(snapshot),res=null;
    for(let attempt=0;attempt<3;attempt++){
      cloudWriteBusy=true;res=await rpcSaveCloud(candidate,baseRevision);cloudWriteBusy=false;
      if(res.r.ok)break;
      const em=res.j?.message||res.body||'שמירה לענן נכשלה';
      if(!String(em).includes('revision_conflict'))throw new Error(em);
      const remote=await readSupabaseDocument();if(!remote)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const merged=mergeKupaCloudState3Way(baseState,candidate,remote.state);
      if(merged.conflicts.length){stageCloudPendingLocal(snapshot,msg,pending.baseRevision,pending.baseState,generation,true);cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');alert('הסנכרון נעצר: אותה רשומה שונתה במקביל בשני מקומות. השינוי המקומי נשמר ולא נדרס.');return false}
      candidate=merged.state;baseRevision=Number(remote.revision||0);baseState=prepareKupaCloudState(remote.state);res=null
    }
    if(!res?.r?.ok)throw new Error('הענן השתנה שוב בזמן השמירה; השינוי נשמר מקומית וינוסה שוב');
    const row=res.row,newRev=Number(row?.revision||baseRevision+1),authoritative=prepareKupaCloudState(row?.state||candidate);dbRevision=newRev;lastSavedSnapshot=JSON.stringify(authoritative);serverInfo.lastSavedAt=row?.updated_at||new Date().toISOString();cloudConflictPending=false;
    const newer=await rebaseNewerPending(generation,authoritative,newRev);
    if(!newer){await clearCloudPending(generation);if(generation===localGeneration)state=applyKupaCloudState(authoritative,state.checks);setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');toast(msg)}else{const newest=await getCloudPending();if(newest){state=applyKupaCloudState(newest.snapshot,state.checks);cloudConflictPending=!!newest.conflict}setSaveStatus(cloudConflictPending?'התנגשות שמורה מקומית':'שומר שינוי נוסף…',cloudConflictPending?'error':'saving');setCloudHeaderStatus(cloudConflictPending?'conflict':'syncing',cloudConflictPending?'ענן: התנגשות':'ענן: מסנכרן…')}
    persistImmediateBrowserSnapshot(state,dbRevision);await backupSnapshotToComputer(state,dbRevision);if(generation===localGeneration||newer)render();if(newer&&!cloudConflictPending)setTimeout(cloudPoll,0);return !cloudConflictPending
  }catch(e){cloudWriteBusy=false;console.error(e);stageCloudPendingLocal(prepareKupaCloudState(state),msg,dbRevision,lastSavedCloudState()||pending.baseState||snapshot,localGeneration,false);persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');toast('השינוי נשמר מקומית וממתין לסנכרון לענן');return false}
  finally{cloudWriteBusy=false;cloudSyncBusy=false}
}
async function cloudPoll(){
  if(!primaryTab||connectionMode!=='supabase'||!backendReady||!navigator.onLine)return;
  if(cloudSyncBusy||cloudWriteBusy){await pollSharedChecks();return}
  const pending=await getCloudPending();if(pending){if(pending.conflict){cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollSharedChecks();return}await reconcileCloudPending();await pollSharedChecks();return}
  if(cloudConflictPending){await pollSharedChecks();return}
  try{cloudSyncBusy=true;const row=await readSupabaseDocument();if(row&&Number(row.revision||0)>dbRevision){const base=lastSavedCloudState(),clean=!!base&&jsonEq(prepareKupaCloudState(state),base);if(clean){await applyCloudRow(row);toast('התקבל עדכון ממחשב אחר')}else{stageCloudPendingLocal(prepareKupaCloudState(state),'שינוי מקומי ממתין',dbRevision,base||prepareKupaCloudState(state),localGeneration,false);cloudSyncBusy=false;await reconcileCloudPending(row)}}}catch(e){console.error('cloud poll',e)}finally{cloudSyncBusy=false;await pollSharedChecks()}
}
function startCloudPolling(){if(cloudPollTimer)clearInterval(cloudPollTimer);cloudPollTimer=setInterval(cloudPoll,12000)}
window.addEventListener('online',()=>{if(connectionMode==='supabase'){setSaveStatus('חזרה רשת — מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: חזרה רשת…');setTimeout(cloudPoll,250)}});
window.addEventListener('offline',()=>{if(connectionMode==='supabase'){persistImmediateBrowserSnapshot(state,dbRevision);setSaveStatus('אופליין — שינויים יישמרו מקומית','saving');setCloudHeaderStatus('offline','ענן: אופליין')}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&connectionMode==='supabase')setTimeout(cloudPoll,100)});
async function discardCloudPendingAndLoadRemote(){if(!cloudConflictPending)return loadSupabaseState();if(!confirm('פעולה זו תוותר על השינוי המקומי שממתין ותטען את גרסת הענן. מומלץ קודם ללחוץ על ייצא JSON. להמשיך?'))return;await clearCloudPending(Infinity);cloudConflictPending=false;await loadSupabaseState();toast('נטענה גרסת הענן')}
function openSupabaseLoginModal(mode='open'){
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const email=localStorage.getItem(SUPA_EMAIL_KEY)||'';
  modal(mode==='upload'?'הפעלת סנכרון Supabase':'פתיחת קופה מהענן',`<div class="form-grid"><div class="form-group full"><div class="notice">הנתונים העסקיים נשמרים ב־Supabase ולא בזיכרון הדפדפן. בדפדפן נשמרים רק פרטי התחברות/Session כדי שלא תצטרך להתחבר בכל פתיחה.</div></div><div class="form-group full"><label>אימייל משתמש Supabase Auth</label><input id="supaEmail" type="email" value="${esc(email)}" autocomplete="username"></div><div class="form-group full"><label>סיסמה</label><input id="supaPassword" type="password" autocomplete="current-password"></div><div class="form-group full"><div id="supaLoginError" class="notice warn" style="display:none"></div></div><div class="form-group full"><div class="soft-note">${mode==='upload'?'אם עדיין אין קופה בענן, הנתונים הפתוחים כרגע יועלו כעותק הראשי. אם כבר קיימת קופה בענן, המערכת לא תדרוס אותה.':'המערכת תפתח את הקופה הקיימת בענן. אם עוד לא הועלתה קופה, פתח קודם את התיקייה המקומית והפעל ענן מתוך ההגדרות.'}</div></div></div>`,mode==='upload'?'התחבר והפעל ענן':'התחבר ופתח',`connectSupabaseFromLogin('${mode}')`)
}
async function showCloudNoDocument(){
  cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · טרם הועלתה קופה');
  const ses=loadSupaSession(),email=ses?.user?.email||localStorage.getItem(SUPA_EMAIL_KEY)||'משתמש מחובר';
  setConnectUI({title:'מחובר ל-Supabase — עדיין אין קופה בענן',text:`ההתחברות הצליחה כ־<b>${esc(email)}</b> לפרויקט <b>${esc(supaProjectRef())}</b>, אבל למשתמש הזה עדיין אין מסמך קופה בשם <b>${esc(cloudDocumentName)}</b>.`,note:'זה לא כשל התחברות. אם זה המשתמש הנכון — פתח את הקופה המקומית, עבור אל <b>הגדרות וגיבוי</b> ולחץ <b>הפעל ענן והעלה את הקופה הנוכחית</b>. אם זה משתמש אחר, לחץ <b>התחבר עם משתמש אחר</b>.',showChoose:true,showFile:!window.showDirectoryPicker,showCloud:true});
  configureCloudConnectButton('התחבר עם משתמש אחר','reauth');
}
async function openCloudUsingSavedSession({interactive=true}={}){
  if(!primaryTab){showSecondaryTabGuard();return false}
  if(!supaConfigured())return false;
  const saved=await restoreSupaSession();if(!saved){if(interactive)openSupabaseLoginModal('open');return false}
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const row=await readSupabaseDocument();
    if(!row){await showCloudNoDocument();return false}
    const pending=await getCloudPending();if(pending){connectionMode='supabase';backendReady=true;document.getElementById('connectScreen').style.display='none';dbRevision=Number(row.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling();return true}
    await applyCloudRow(row);return true
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');if(interactive)openSupabaseLoginModal('open');return false}setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: שגיאת חיבור':'ענן: אופליין');if(await openBrowserStateFallback())return true;if(interactive)alert('לא ניתן לפתוח את הקופה מהענן: '+friendlySupabaseError(e));return false}
}
async function enableCloudFromCurrentState(){
  if(!primaryTab){showSecondaryTabGuard();return}
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const saved=await restoreSupaSession();if(!saved)return openSupabaseLoginModal('upload');
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const existing=await readSupabaseDocument();
    if(existing){const pending=await getCloudPending();if(pending){connectionMode='supabase';backendReady=true;dbRevision=Number(existing.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(existing.state));document.getElementById('connectScreen').style.display='none';await reconcileCloudPending(existing);sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render()}else await applyCloudRow(existing);toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
    const localSnapshot=clone(state);connectionMode='supabase';backendReady=true;dbRevision=0;serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none'
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');openSupabaseLoginModal('upload');return}alert('לא ניתן להפעיל את הענן: '+friendlySupabaseError(e))}
}
async function connectSupabaseFromLogin(mode){
  const email=document.getElementById('supaEmail')?.value.trim(),password=document.getElementById('supaPassword')?.value||'';if(!email||!password)return toast('יש להזין אימייל וסיסמה');
  try{
    await supaAuthPassword(email,password);
    if(mode==='upload'){
      const existing=await readSupabaseDocument();
      if(existing){closeModal();await applyCloudRow(existing);toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
      const localSnapshot=clone(state);connectionMode='supabase';backendReady=true;dbRevision=0;serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');closeModal();await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none';return
    }
    const row=await readSupabaseDocument();closeModal();if(!row){await showCloudNoDocument();return}const pending=await getCloudPending();if(pending){connectionMode='supabase';backendReady=true;dbRevision=Number(row.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));document.getElementById('connectScreen').style.display='none';await reconcileCloudPending(row);sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling()}else await applyCloudRow(row)
  }catch(e){
    console.error(e);
    const msg='לא ניתן להתחבר ל-Supabase: '+friendlySupabaseError(e);
    const box=document.getElementById('supaLoginError');
    if(box){box.textContent=msg;box.style.display='block'}else alert(msg);
  }
}
async function tryAutoOpenSupabase(){
  if(!primaryTab)return false;if(!supaConfigured())return false;const s=await restoreSupaSession();if(!s)return false;
  try{setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const row=await readSupabaseDocument();if(!row){cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · אין קופה');return false}const pending=await getCloudPending();if(pending){connectionMode='supabase';backendReady=true;document.getElementById('connectScreen').style.display='none';dbRevision=Number(row.revision||0);lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling();return true}await applyCloudRow(row);return true}catch(e){console.error('auto cloud',e);if(isSupabaseAuthError(e)){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות')}else{setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: לא זמין':'ענן: אופליין');if(await openBrowserStateFallback())return true}return false}
}
function logoutSupabase(){if(!primaryTab){showSecondaryTabGuard();return}if(cloudPollTimer){clearInterval(cloudPollTimer);cloudPollTimer=null}storeSupaSession(null);localStorage.removeItem(STORAGE_PREF_KEY);localStorage.removeItem(SUPA_AUTO_KEY);cloudAuthNoDocument=false;setCloudHeaderStatus('off','ענן: לא מחובר');if(connectionMode==='supabase'){backendReady=false;document.getElementById('connectScreen').style.display='flex';showFirstRun()}toast('ההתחברות לענן נמחקה מהמחשב הזה. שינויים שטרם סונכרנו לא נמחקו.')}



async function openLastFolder(){const h=await getRememberedHandle();if(!h)return showFirstRun();try{await connectDirectory(h)}catch(e){console.error(e);showRememberedFolderPrompt('לא ניתן לפתוח את הקופה השמורה. אפשר לאשר גישה מחדש או לבחור תיקייה אחרת.')}}

function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function wholeMoney(v){return Math.round(num(v))}
function money(v){return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(num(v))}
function dateFmt(v){if(!v)return '—'; const d=new Date(v+'T12:00:00'); return new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}
function todayISO(){const d=new Date();return localISO(d)}
function localISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dObj(v){return v?new Date(v+'T12:00:00'):null}
function daysFromToday(v){const a=dObj(v),b=dObj(todayISO());return a?Math.round((a-b)/86400000):99999}
function monthKey(v){if(!v)return '';return v.slice(0,7)}
function monthLabel(k){if(!k)return '';const [y,m]=k.split('-').map(Number);return `${HEB_MONTHS[m-1]} ${y}`}
function addMonthsISO(dateStr,n){const d=dObj(dateStr);const day=d.getDate();const x=new Date(d.getFullYear(),d.getMonth()+n,1);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return localISO(x)}
function checkDateParts(value){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!m)return {day:'',month:'',year:''};return {day:m[3],month:m[2],year:String(Number(m[1])%100).padStart(2,'0')}}
function checkDateEditorMarkup(id,value='',options={}){const p=checkDateParts(value),role=options.role||'',seriesField=options.seriesField||'',manual=options.manual?'1':'0',label=options.label||'תאריך';return `<div class="check-date-editor${options.series?' check-series-date':''}" data-check-date-editor data-date-role="${esc(role)}" data-date-label="${esc(label)}"><input class="check-date-part" data-date-part="day" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="יום" aria-label="יום" value="${esc(p.day)}" onfocus="this.select()" oninput="handleCheckDatePartInput(this)" onblur="handleCheckDatePartBlur(this)" onkeydown="handleCheckDatePartKeydown(event,this)"><span class="date-sep">/</span><input class="check-date-part" data-date-part="month" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="חודש" aria-label="חודש" value="${esc(p.month)}" onfocus="this.select()" oninput="handleCheckDatePartInput(this)" onblur="handleCheckDatePartBlur(this)" onkeydown="handleCheckDatePartKeydown(event,this)"><span class="date-sep">/</span><input class="check-date-part" data-date-part="year" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="שנה" aria-label="שנה דו ספרתית" value="${esc(p.year)}" onfocus="this.select()" oninput="handleCheckDatePartInput(this)" onblur="handleCheckDatePartBlur(this)" onkeydown="handleCheckDatePartKeydown(event,this)"><button type="button" class="check-date-picker-btn" title="בחירה מלוח שנה" aria-label="בחירה מלוח שנה" onclick="openCheckDatePicker(this)">▦</button><input class="check-date-native-picker" data-date-picker type="date" tabindex="-1" aria-hidden="true" value="${esc(value||'')}" onchange="applyCheckDatePicker(this)"><input type="hidden" ${id?`id="${esc(id)}"`:''} data-check-date-value ${seriesField?`data-series-field="${esc(seriesField)}"`:''} data-manual="${manual}" value="${esc(value||'')}"></div>`}
function checkDateEditorValue(editor){if(!editor)return {iso:'',complete:false,empty:true,valid:true};const day=(editor.querySelector('[data-date-part="day"]')?.value||'').replace(/\D/g,''),month=(editor.querySelector('[data-date-part="month"]')?.value||'').replace(/\D/g,''),year=(editor.querySelector('[data-date-part="year"]')?.value||'').replace(/\D/g,'');const empty=!day&&!month&&!year,complete=day.length>=1&&month.length>=1&&year.length===2;if(empty)return {iso:'',complete:false,empty:true,valid:true};if(!complete)return {iso:'',complete:false,empty:false,valid:false};const d=Number(day),m=Number(month),y=2000+Number(year);const probe=new Date(y,m-1,d);const valid=d>=1&&m>=1&&m<=12&&probe.getFullYear()===y&&probe.getMonth()===m-1&&probe.getDate()===d;return {iso:valid?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'',complete:true,empty:false,valid}}
function notifyCheckDateEditor(editor){const hidden=editor?.querySelector('[data-check-date-value]');if(!hidden)return;const role=editor.dataset.dateRole||'';if(role==='series-first')syncCheckSeriesFromFirst();else if(role==='series-manual')markCheckSeriesManual(hidden)}
function commitCheckDateEditor(editor,notify=true){if(!editor)return false;const result=checkDateEditorValue(editor),hidden=editor.querySelector('[data-check-date-value]'),picker=editor.querySelector('[data-date-picker]');if(hidden)hidden.value=result.iso;if(picker)picker.value=result.iso;editor.classList.toggle('invalid',!result.empty&&!result.valid);if(notify)notifyCheckDateEditor(editor);return result.valid}
function setCheckDateValue(target,value,notify=false){const hidden=target?.matches?.('[data-check-date-value]')?target:target?.querySelector?.('[data-check-date-value]');const editor=hidden?.closest('[data-check-date-editor]');if(!hidden||!editor)return;const p=checkDateParts(value);editor.querySelector('[data-date-part="day"]').value=p.day;editor.querySelector('[data-date-part="month"]').value=p.month;editor.querySelector('[data-date-part="year"]').value=p.year;hidden.value=value||'';const picker=editor.querySelector('[data-date-picker]');if(picker)picker.value=value||'';editor.classList.remove('invalid');if(notify)notifyCheckDateEditor(editor)}
function handleCheckDatePartInput(input){const editor=input.closest('[data-check-date-editor]');input.value=input.value.replace(/\D/g,'').slice(0,2);const part=input.dataset.datePart;if((part==='day'||part==='month')&&input.value.length===2){const next=part==='day'?editor.querySelector('[data-date-part="month"]'):editor.querySelector('[data-date-part="year"]');next?.focus();next?.select()}commitCheckDateEditor(editor,true)}
function handleCheckDatePartBlur(input){const editor=input.closest('[data-check-date-editor]');if((input.dataset.datePart==='day'||input.dataset.datePart==='month')&&input.value.length===1)input.value=input.value.padStart(2,'0');commitCheckDateEditor(editor,true)}
function handleCheckDatePartKeydown(event,input){if(event.key!=='Backspace'||input.value)return;const editor=input.closest('[data-check-date-editor]'),part=input.dataset.datePart,prev=part==='year'?editor.querySelector('[data-date-part="month"]'):part==='month'?editor.querySelector('[data-date-part="day"]'):null;if(prev){event.preventDefault();prev.focus();prev.select()}}
function openCheckDatePicker(button){const editor=button.closest('[data-check-date-editor]'),picker=editor?.querySelector('[data-date-picker]'),hidden=editor?.querySelector('[data-check-date-value]');if(!picker)return;if(hidden?.value)picker.value=hidden.value;try{if(typeof picker.showPicker==='function')picker.showPicker();else picker.click()}catch(e){picker.click()}}
function applyCheckDatePicker(picker){const editor=picker.closest('[data-check-date-editor]');setCheckDateValue(editor,picker.value,true)}
function normalizeCheckModalDates(){const editors=[...document.querySelectorAll('#modal [data-check-date-editor]')];for(const editor of editors){for(const part of editor.querySelectorAll('[data-date-part="day"],[data-date-part="month"]'))if(part.value.length===1)part.value=part.value.padStart(2,'0');const result=checkDateEditorValue(editor);commitCheckDateEditor(editor,false);if(!result.empty&&!result.valid){const label=editor.dataset.dateLabel||'תאריך';toast(`${label}: יש להזין יום, חודש ושתי ספרות שנה תקינים`);editor.querySelector(result.complete?'[data-date-part="day"]':'[data-date-part="year"]')?.focus();return false}}return true}
function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`}
function activeChecks(){return state.checks.filter(x=>x.status==='בקופה')}
function depositedChecks(){return state.checks.filter(x=>x.status==='הופקד - במעקב')}
function cashBalance(){return state.cash.reduce((a,x)=>a+num(x.amount),0)}
function checksBalance(){return activeChecks().reduce((a,x)=>a+num(x.amount),0)}
function depositedBalance(){return depositedChecks().reduce((a,x)=>a+num(x.amount),0)}
function checkUrgency(c){if(c.status!=='בקופה')return '';const d=daysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}
function rawCreditSchedule(cr){if(!cr.firstChargeDate||num(cr.installments)<1)return[];const total=num(cr.totalAmount),n=Number(cr.installments);const base=Math.round((total/n)*100)/100;let rows=[];let used=0;for(let i=0;i<n;i++){let amt=i===n-1?Math.round((total-used)*100)/100:base;used+=amt;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount:amt,part:i+1,totalParts:n,card:cr.card,account:cr.account,description:cr.description})}return rows}
function creditSchedule(cr){return cr.active?rawCreditSchedule(cr):[]}
function inactiveCreditExpired(cr,asOf=todayISO()){if(cr?.active!==false)return false;const rows=rawCreditSchedule(cr);if(!rows.length)return false;const last=rows[rows.length-1].date;return Math.floor((dObj(asOf)-dObj(last))/86400000)>60}
function creditProgress(cr,asOf=todayISO()){const schedule=creditSchedule(cr);const completed=schedule.filter(x=>x.date<asOf);const pending=schedule.filter(x=>x.date>=asOf);return {schedule,completed,pending,completedCount:completed.length,remainingCount:pending.length,next:pending[0]||null,remainingAmount:pending.reduce((a,x)=>a+x.amount,0),complete:cr.active&&schedule.length>0&&pending.length===0}}
function pendingInstallments(){return allInstallments().filter(x=>x.date>=todayISO())}
function allInstallments(){return state.credits.flatMap(creditSchedule)}
function monthSumInstallments(key,pendingOnly=false){const rows=pendingOnly?pendingInstallments():allInstallments();return rows.filter(x=>monthKey(x.date)===key).reduce((a,x)=>a+x.amount,0)}
function expenseOccurrencesForMonth(key,pendingOnly=false){const [yy,mm]=key.split('-').map(Number),start=new Date(yy,mm-1,1),end=new Date(yy,mm,0);return state.expenses.filter(x=>x.active).flatMap(x=>{let due;if(x.recurring!==false){const base=dObj(x.date||`${key}-01`);const day=Math.max(1,Math.min(base.getDate()||1,end.getDate()));due=localISO(new Date(yy,mm-1,day))}else{if(monthKey(x.date)!==key)return[];due=x.date}if(pendingOnly&&due<todayISO())return[];return [{...x,dueDate:due}]})}
function monthSumExpenses(key,pendingOnly=false){return expenseOccurrencesForMonth(key,pendingOnly).reduce((a,x)=>a+num(x.amount),0)}
function bankBaseBalance(){return state.bank?.currentBalance===null||state.bank?.currentBalance===undefined?null:num(state.bank.currentBalance)}
function bankAdjustments(){return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type!=='check_deposit')}
function bankAdjustmentsTotal(){return bankAdjustments().reduce((a,x)=>a+num(x.amount),0)}
function bankAsOfDate(){return state.bank?.asOfDate||(state.bank?.updatedAt?String(state.bank.updatedAt).slice(0,10):todayISO())}
function checkBankEffectAmount(c){return c&&['הופקד - במעקב','נפרע'].includes(c.status)?num(c.amount):0}
function pendingSharedCheckBankDelta(){if(!sharedChecksBase)return 0;const base=new Map(normalizeSharedChecks(sharedChecksBase).map(c=>[c.id,c])),local=new Map(normalizeSharedChecks(state.checks).map(c=>[c.id,c])),ids=new Set([...base.keys(),...local.keys()]);let total=0;for(const id of ids)total+=checkBankEffectAmount(local.get(id))-checkBankEffectAmount(base.get(id));return total}
function sharedChecksObservedSequence(){const floor=Number(state.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(sharedChecksBankEvents).reduce((m,e)=>Math.max(m,e.seq),start)}
function checkDepositedAfterBankSnapshot(c){if(!c||!['הופקד - במעקב','נפרע'].includes(c.status))return false;const depositSeq=Number(c.depositSeq),snapshotSeq=Number(state.bank?.snapshotSeq);if(Number.isSafeInteger(depositSeq)&&depositSeq>0&&Number.isSafeInteger(snapshotSeq)&&snapshotSeq>0)return depositSeq>snapshotSeq;const updatedAt=state.bank?.updatedAt,asOf=bankAsOfDate();if(c.depositedAt&&updatedAt){const a=Date.parse(c.depositedAt),b=Date.parse(updatedAt);if(Number.isFinite(a)&&Number.isFinite(b))return a>b}return !!(c.depositDate&&asOf&&c.depositDate>asOf)}
function bankDerivedCheckDeposits(){return normalizeSharedChecks(state.checks).filter(checkDepositedAfterBankSnapshot)}
function legacyCheckDepositFallbacks(){const derived=new Set(bankDerivedCheckDeposits().map(x=>x.id));return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type==='check_deposit'&&!derived.has(String(x.refId||'')))}
function bankCheckEffectsTotal(){const snapshotSeq=Number(state.bank?.snapshotSeq);if(Number.isSafeInteger(snapshotSeq)&&snapshotSeq>=0)return normalizeSharedBankEvents(sharedChecksBankEvents).filter(e=>e.seq>snapshotSeq).reduce((a,e)=>a+num(e.delta),0)+pendingSharedCheckBankDelta();return bankDerivedCheckDeposits().reduce((a,x)=>a+num(x.amount),0)+legacyCheckDepositFallbacks().reduce((a,x)=>a+num(x.amount),0)}
function bankCurrentBalance(){const b=bankBaseBalance();return b===null?null:b+bankAdjustmentsTotal()+bankCheckEffectsTotal()}
function monthKeysBetween(startISO,endISO){const a=dObj(startISO),b=dObj(endISO),out=[];let y=a.getFullYear(),m=a.getMonth();while(y<b.getFullYear()||(y===b.getFullYear()&&m<=b.getMonth())){out.push(`${y}-${String(m+1).padStart(2,'0')}`);m++;if(m>11){m=0;y++}}return out}
function nextCreditCycle(reference=todayISO()){
  const future=allInstallments().filter(x=>x.date>=reference);
  const byCard=new Map();
  future.forEach(x=>{const cur=byCard.get(x.card);if(!cur||x.date<cur)byCard.set(x.card,x.date)});
  const rows=future.filter(x=>byCard.get(x.card)===x.date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
  const targetDate=rows.length?rows.reduce((m,x)=>x.date>m?x.date:m,rows[0].date):reference;
  const targetMonth=monthKey(targetDate);
  const [y,m]=targetMonth.split('-').map(Number);
  const targetEnd=localISO(new Date(y,m,0));
  return {rows,total:rows.reduce((a,x)=>a+x.amount,0),targetDate,targetMonth,targetEnd};
}

function expenseRowsBetween(start,end){if(!start||!end)return[];return monthKeysBetween(start,end).flatMap(k=>expenseOccurrencesForMonth(k,false)).filter(x=>x.dueDate>=start&&x.dueDate<=end)}
function bankNextCycleCommitments(){
  const b=bankCurrentBalance();const start=bankAsOfDate(),today=todayISO(),cycle=nextCreditCycle(today);
  if(b===null)return {credit:0,expenses:0,total:0,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:0,elapsedExpenses:0,targetExpenseRows:[]};
  const elapsedCreditRows=allInstallments().filter(x=>x.date>=start&&x.date<today);
  const elapsedExpenseRows=expenseRowsBetween(start,today).filter(x=>x.dueDate<today);
  const targetExpenseRows=expenseOccurrencesForMonth(cycle.targetMonth,false).filter(x=>x.dueDate>=today);
  const creditRows=[...elapsedCreditRows,...cycle.rows].filter((x,i,a)=>a.findIndex(y=>y.creditId===x.creditId&&y.part===x.part)===i);
  const expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((x,i,a)=>a.findIndex(y=>y.id===x.id&&y.dueDate===x.dueDate)===i);
  const credit=creditRows.reduce((a,x)=>a+x.amount,0),expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  return {credit,expenses,total:credit+expenses,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:elapsedCreditRows.reduce((a,x)=>a+x.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((a,x)=>a+num(x.amount),0),targetExpenseRows};
}
function bankLongTermPosition(){
  const b=bankCurrentBalance();const start=bankAsOfDate(),cycle=nextCreditCycle(todayISO());
  if(b===null)return {bank:null,credit:0,expenses:0,cash:cashBalance(),checks:checksBalance(),kupa:cashBalance()+checksBalance(),net:null,targetMonth:cycle.targetMonth};
  const credit=allInstallments().filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0);
  const expenseRows=expenseOccurrencesForMonth(cycle.targetMonth,false).filter(x=>cycle.targetMonth!==monthKey(start)||x.dueDate>=start);
  const expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  const cash=cashBalance(),checks=checksBalance(),kupa=cash+checks;
  return {bank:b,credit,expenses,cash,checks,kupa,net:b-credit-expenses+kupa,targetMonth:cycle.targetMonth};
}
function bankProjectedThisMonth(){const b=bankCurrentBalance();if(b===null)return null;return b-bankNextCycleCommitments().total}
function formatNullableMoney(v){return v===null?'—':money(v)}
// הפקדות צקים אינן נרשמות עוד כתנועת בנק כפולה. יתרת העו״ש נגזרת ממקור הצקים המשותף ביחס לצילום היתרה האחרון.


function monthSumChecks(key,status='בקופה'){return state.checks.filter(x=>x.status===status&&monthKey(x.dueDate)===key).reduce((a,x)=>a+num(x.amount),0)}
function badgeStatus(s){const cls=s==='בקופה'?'blue':s==='הופקד - במעקב'?'orange':s==='נפרע'?'green':s==='חזר'?'red':'';return `<span class="badge ${cls}">${esc(s)}</span>`}
function dueBadge(c){const u=checkUrgency(c);if(u==='overdue')return '<span class="badge red">עבר מועד</span>';if(u==='week')return '<span class="badge orange">השבוע</span>';if(u==='month')return '<span class="badge yellow">עד 30 יום</span>';return ''}
function toast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}
function setPage(p){bulkCollection=null;bulkSelected.clear();currentPage=p;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));const [t,s]=TITLES[p];document.getElementById('pageTitle').textContent=t;document.getElementById('pageSub').textContent=s;document.getElementById('sidebar').classList.remove('open');render()}
function render(){if(currentPage==='dashboard')renderDashboard();if(currentPage==='checks')renderChecks();if(currentPage==='credit')renderCredit();if(currentPage==='cash')renderCash();if(currentPage==='bank')renderBank();if(currentPage==='expenses')renderBank();if(currentPage==='settings')renderSettings()}
function dashboardGo(page,tab='',focus='all'){
  if(page==='checks'){
    checkTab=tab||'open';
    checkYear='all';
    checkFocus=focus||'all';
    checkSearchValue='';
  }
  setPage(page);
}
function renderDashboard(){
  const now=new Date();
  const due7=activeChecks().filter(c=>{const d=daysFromToday(c.dueDate);return d>=0&&d<=7}).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const overdue=activeChecks().filter(c=>daysFromToday(c.dueDate)<0).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const depOver=depositedChecks().filter(c=>daysFromToday(c.dueDate)<0).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const criticalAlerts=[
    ...overdue.map(c=>({kind:'open',id:c.id,c:'#b86561',t:`${c.name} — ${money(c.amount)}`,s:`צק בקופה עבר מועד (${dateFmt(c.dueDate)})`})),
    ...depOver.map(c=>({kind:'deposited',id:c.id,c:'#8b7ca0',t:`${c.name} — ${money(c.amount)}`,s:`הופקד וממתין לסימון נפרע · פירעון ${dateFmt(c.dueDate)}`}))
  ].sort((a,b)=>{
    const ca=state.checks.find(x=>x.id===a.id),cb=state.checks.find(x=>x.id===b.id);
    return (ca?.dueDate||'').localeCompare(cb?.dueDate||'');
  });
  const upcomingAlerts=due7.map(c=>({kind:'open',id:c.id,c:'#c59661',t:`${c.name} — ${money(c.amount)}`,s:`פירעון קרוב ${dateFmt(c.dueDate)}`}));
  const alerts=[...criticalAlerts,...upcomingAlerts];
  const months=[];for(let i=0;i<6;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1),k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push({k,label:HEB_MONTHS[d.getMonth()],checks:monthSumChecks(k),credit:monthSumInstallments(k,true)+monthSumExpenses(k,true)})}
  const max=Math.max(1,...months.map(x=>Math.max(x.checks,x.credit)));
  const cycle=bankNextCycleCommitments(),bankAfter=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth),futureCreditRows=pendingInstallments(),futureCreditTotal=futureCreditRows.reduce((a,x)=>a+x.amount,0);
  document.getElementById('content').innerHTML=`
  <div class="grid kpis">
   ${kpi('מזומן בקופה',cashBalance(),'#edf4f1','#638f87','יתרת תנועות המזומן',`dashboardGo('cash')`)}
   ${kpi('צקים בקופה',checksBalance(),'#eef2f3','#76929a',`${activeChecks().length} צקים פתוחים`,`dashboardGo('checks','open')`)}
   ${kpi('סה״כ קופה',cashBalance()+checksBalance(),'#eff4ef','#72957b','מזומן + צקים שטרם הופקדו',`dashboardGo('checks','open')`)}
   ${kpi('הופקדו במעקב',depositedBalance(),'#f7f1e8','#b78b57',`${depositedChecks().length} צקים ממתינים`,`dashboardGo('checks','deposited')`)}
  </div>
  <div class="grid kpis" style="margin-top:16px">
   ${kpi('סה״כ אשראי עתידי',futureCreditTotal,'#f7efe7','#c59661',futureCreditRows.length?`${futureCreditRows.length} חיובים עתידיים שנותרו`:'אין חיובי אשראי עתידיים',`dashboardGo('credit')`)}
   ${kpi('אשראי במחזור הקרוב',cycle.nextCreditTotal,'#edf4f1','#638f87',cycle.nextCreditRows.length?`החיובים הקרובים עד ${dateFmt(cycle.end)} · ${cycleLabel}`:'אין חיוב אשראי עתידי',`dashboardGo('credit')`)}
   ${kpiDisplay('עו״ש אחרי המחזור הקרוב',bankAfter,'#eff3f0','#5f7c77',bankAfter===null?'יש להזין יתרת עו״ש בטאב בנק':`כולל אשראי קרוב + הוצאות ${cycleLabel}`,`dashboardGo('bank')`)}
   ${kpiDisplay('מאזן כולל נטו',long.net,'#edf3ef','#557a68',long.net===null?'יש להזין יתרת עו״ש':`עו״ש − כל האשראי העתידי − חודש הוצאות + קופה`,`dashboardGo('bank')`)}
  </div>
  <div class="grid two" style="margin-top:16px">
   <section class="section"><div class="section-head"><div><h3>פעולות מהירות</h3><div class="muted">העבודה השוטפת בלי להיכנס לטבלאות</div></div></div><div class="section-body"><div class="quick">
    <button onclick="openCheckModal()"><b>+ צק חדש</b><span>שם, סכום ותאריך פירעון</span></button>
    <button onclick="openCreditModal()"><b>+ עסקת אשראי</b><span>סכום, כרטיס ומספר תשלומים</span></button>
    <button onclick="setPage('bank')"><b>בנק ועו״ש</b><span>יתרה, מחזור קרוב ומאזן כולל</span></button>
   </div></div></section>
   <section class="section"><div class="section-head"><div><h3>דורש תשומת לב</h3><div class="muted">חריגים מוצגים במלואם; פירעונות קרובים מסומנים בנפרד</div></div><span class="badge ${criticalAlerts.length?'red':'green'}">${criticalAlerts.length} חריגים${upcomingAlerts.length?` · ${upcomingAlerts.length} קרובים`:''}</span></div><div class="section-body"><div class="alert-list">${alerts.length?alerts.map(a=>`<div class="alert" style="--c:${a.c}"><div><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><div class="alert-actions">${a.kind==='deposited'?`<button class="iconbtn" onclick="markCleared('${a.id}')">נפרע</button>`:`<button class="iconbtn" onclick="markDeposited('${a.id}')">הופקד</button>`}<button class="iconbtn" onclick="openCheckModal('${a.id}')">עריכה</button></div></div>`).join(''):'<div class="empty">אין כרגע חריגים או פירעונות קרובים.</div>'}</div></div></section>
  </div>
  <div class="grid two" style="margin-top:16px">
   <section class="section"><div class="section-head"><div><h3>6 חודשים קדימה — צקים</h3><div class="muted">צקים שנמצאים בקופה לפי חודש פירעון</div></div></div><div class="section-body"><div class="bar-list">${months.map(x=>barRow(x.label,x.checks,max,'#76929a')).join('')}</div></div></section>
   <section class="section"><div class="section-head"><div><h3>6 חודשים קדימה — אשראי והוצאות</h3><div class="muted">רק התחייבויות שטרם הגיע מועדן</div></div></div><div class="section-body"><div class="bar-list">${months.map(x=>barRow(x.label,x.credit,max,'#638f87')).join('')}</div></div></section>
  </div>`}
function kpiAttrs(action){
  if(!action)return '';
  return ` role="button" tabindex="0" onclick="${action}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${action}}"`;
}
function kpiDisplay(label,value,accent,dot,hint,action=''){return `<div class="kpi${action?' clickable':''}" style="--accent:${accent};--dot:${dot}"${kpiAttrs(action)}><div class="label"><span class="dot"></span>${label}</div><div class="value">${formatNullableMoney(value)}</div><div class="hint">${hint}</div></div>`}
function kpi(label,value,accent,dot,hint,action=''){return `<div class="kpi${action?' clickable':''}" style="--accent:${accent};--dot:${dot}"${kpiAttrs(action)}><div class="label"><span class="dot"></span>${label}</div><div class="value">${money(value)}</div><div class="hint">${hint}</div></div>`}
function barRow(label,val,max,c){return `<div class="bar-row"><b>${label}</b><div class="bar"><i style="--bar:${c};width:${Math.max(2,val/max*100)}%"></i></div><div class="num">${money(val)}</div></div>`}
function checkFocusMatch(x){
  if(checkFocus==='due7'){const d=daysFromToday(x.dueDate);return x.status==='בקופה'&&d>=0&&d<=7}
  if(checkFocus==='overdue')return x.status==='בקופה'&&daysFromToday(x.dueDate)<0;
  return true;
}
function clearCheckFocus(){checkFocus='all';renderChecks()}
function bulkModeFor(collection){return bulkCollection===collection}
function toggleBulkMode(collection){if(bulkCollection===collection){bulkCollection=null;bulkSelected.clear()}else{bulkCollection=collection;bulkSelected.clear()}render()}
function toggleBulkRow(collection,id,checked){if(!bulkModeFor(collection))return;if(!state[collection]?.some(x=>x.id===id))return;if(checked)bulkSelected.add(id);else bulkSelected.delete(id);syncBulkUi(collection)}
function visibleBulkIds(collection){return [...document.querySelectorAll(`[data-bulk-collection="${collection}"][data-bulk-id]`)].map(row=>row.dataset.bulkId).filter(Boolean)}
function toggleBulkVisible(collection,checked){if(!bulkModeFor(collection))return;const ids=visibleBulkIds(collection);ids.forEach(id=>checked?bulkSelected.add(id):bulkSelected.delete(id));document.querySelectorAll(`[data-bulk-collection="${collection}"][data-bulk-id] .bulk-check`).forEach(cb=>cb.checked=checked);syncBulkUi(collection)}
function syncBulkUi(collection){
  if(!bulkModeFor(collection))return;
  const valid=new Set((state[collection]||[]).map(x=>x.id));[...bulkSelected].forEach(id=>{if(!valid.has(id))bulkSelected.delete(id)});
  const del=document.getElementById(`bulkDelete-${collection}`);if(del){del.disabled=!bulkSelected.size;del.textContent=bulkSelected.size?`מחק ${bulkSelected.size}`:'מחק נבחרים'}
  const visible=visibleBulkIds(collection),selectedVisible=visible.filter(id=>bulkSelected.has(id)).length;
  document.querySelectorAll(`[data-bulk-all="${collection}"]`).forEach(head=>{head.checked=visible.length>0&&selectedVisible===visible.length;head.indeterminate=selectedVisible>0&&selectedVisible<visible.length});
  document.querySelectorAll(`[data-bulk-collection="${collection}"][data-bulk-id]`).forEach(row=>row.classList.toggle('bulk-selected-row',bulkSelected.has(row.dataset.bulkId)));
}
function bulkControls(collection){
  const active=bulkModeFor(collection);
  return `<button class="btn small bulk-select-toggle ${active?'active':''}" onclick="toggleBulkMode('${collection}')">${active?'סיום בחירה':'בחירה'}</button>${active?`<button id="bulkDelete-${collection}" class="btn danger small bulk-delete-btn" onclick="deleteBulkSelected('${collection}')" disabled>מחק נבחרים</button>`:''}`;
}
function bulkHeader(collection){return bulkModeFor(collection)?`<th class="bulk-check-col"><input class="bulk-check" type="checkbox" data-bulk-all="${collection}" title="בחר את כל השורות המוצגות" onchange="toggleBulkVisible('${collection}',this.checked)"></th>`:''}
function bulkCell(collection,id){return bulkModeFor(collection)?`<td class="bulk-check-col"><input class="bulk-check" type="checkbox" ${bulkSelected.has(id)?'checked':''} aria-label="בחר רשומה" onchange="toggleBulkRow('${collection}','${esc(id)}',this.checked)"></td>`:''}
function deleteBulkSelected(collection){
  if(!['checks','credits','cash'].includes(collection))return;
  const ids=[...bulkSelected].filter(id=>(state[collection]||[]).some(x=>x.id===id));
  if(!ids.length)return toast('לא נבחרו רשומות למחיקה');
  const labels={checks:'צקים',credits:'עסקאות אשראי',cash:'תנועות מזומן'};
  if(!confirm(`למחוק ${ids.length} ${labels[collection]} שנבחרו?\n\nהמחיקה תישמר במקור הנתונים ולא ניתן לבטל אותה מתוך המסך.`))return;
  const set=new Set(ids);state[collection]=state[collection].filter(x=>!set.has(x.id));bulkSelected.clear();if(collection==='checks')saveChecksState(`${ids.length} רשומות נמחקו`);else saveState(`${ids.length} רשומות נמחקו`);render()
}
function visibleChecks(){let rows=[...state.checks];if(checkTab==='open')rows=rows.filter(x=>x.status==='בקופה');if(checkTab==='deposited')rows=rows.filter(x=>x.status==='הופקד - במעקב');if(checkTab==='closed')rows=rows.filter(x=>['נפרע','חזר','בוטל'].includes(x.status));rows=rows.filter(checkFocusMatch);if(checkYear!=='all')rows=rows.filter(x=>x.dueDate?.startsWith(checkYear+'-'));const q=checkSearchValue.trim();if(q)rows=rows.filter(x=>(x.name+' '+x.checkNumber+' '+x.note).includes(q));return rows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''))}
function visibleChecksTotal(rows=visibleChecks()){return rows.reduce((a,x)=>a+num(x.amount),0)}
function renderChecks(){const rows=visibleChecks();const groups={};rows.forEach(r=>(groups[monthKey(r.dueDate)]??=[]).push(r));const years=[...new Set(state.checks.map(x=>x.dueDate?.slice(0,4)).filter(Boolean))].sort();
document.getElementById('content').innerHTML=`<div class="toolbar"><div class="segmented"><button class="${checkTab==='open'?'active':''}" onclick="checkTab='open';checkFocus='all';renderChecks()">בקופה</button><button class="${checkTab==='deposited'?'active':''}" onclick="checkTab='deposited';checkFocus='all';renderChecks()">הופקדו</button><button class="${checkTab==='closed'?'active':''}" onclick="checkTab='closed';checkFocus='all';renderChecks()">נסגרו</button><button class="${checkTab==='all'?'active':''}" onclick="checkTab='all';checkFocus='all';renderChecks()">הכל</button></div><select onchange="checkYear=this.value;renderChecks()"><option value="all">כל השנים</option>${years.map(y=>`<option ${checkYear===y?'selected':''}>${y}</option>`).join('')}</select><input id="checkSearch" value="${esc(checkSearchValue)}" placeholder="חיפוש שם / מספר / הערה" oninput="renderChecksSearch(this.value)" style="min-width:220px"><span class="checks-grand-total" id="checksGrandTotal">סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b></span>${checkFocus==='due7'?`<span class="stat-pill">סינון: פירעון ב־7 ימים <button class="iconbtn" onclick="clearCheckFocus()" title="הסר סינון">×</button></span>`:''}${checkFocus==='overdue'?`<span class="stat-pill">סינון: עבר מועד <button class="iconbtn" onclick="clearCheckFocus()" title="הסר סינון">×</button></span>`:''}<span style="flex:1"></span>${bulkControls('checks')}<button class="btn primary" onclick="openCheckModal()">+ צק חדש</button></div><div id="checkGroups">${renderCheckGroups(groups)}</div>`;syncBulkUi('checks')}
let checkSearchValue='';function renderChecksSearch(v){checkSearchValue=v;const rows=visibleChecks(),g={};rows.forEach(r=>(g[monthKey(r.dueDate)]??=[]).push(r));document.getElementById('checkGroups').innerHTML=renderCheckGroups(g);const total=document.getElementById('checksGrandTotal');if(total)total.innerHTML=`סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b>`;syncBulkUi('checks')}
function renderCheckGroups(groups){const keys=Object.keys(groups).sort();if(!keys.length)return '<section class="section"><div class="empty">אין צקים בתצוגה הזאת.</div></section>';return keys.map(k=>{const arr=groups[k],sum=arr.reduce((a,x)=>a+x.amount,0);return `<div class="month-group"><div class="month-title"><b>${monthLabel(k)}</b><span class="month-check-total">${arr.length} צקים · ${money(sum)}</span></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('checks')}<th>שם</th><th>סכום</th><th>פירעון</th><th>סטטוס</th><th>התראה</th><th>מס׳ צק</th><th>הערה</th><th></th></tr></thead><tbody>${arr.map(checkRow).join('')}</tbody></table></div></div>`}).join('')}
function checkRow(c){return `<tr data-bulk-collection="checks" data-bulk-id="${esc(c.id)}" class="${bulkSelected.has(c.id)?'bulk-selected-row':''}">${bulkCell('checks',c.id)}<td><b>${esc(c.name)}</b></td><td class="amount">${money(c.amount)}</td><td>${dateFmt(c.dueDate)}</td><td>${badgeStatus(c.status)}</td><td>${dueBadge(c)}</td><td>${esc(c.checkNumber)||'—'}</td><td class="muted">${esc(c.note)||'—'}</td><td><div class="row-actions">${c.status==='בקופה'?`<button class="iconbtn" onclick="markDeposited('${c.id}')">הופקד</button>`:''}${c.status==='הופקד - במעקב'?`<button class="iconbtn" onclick="markCleared('${c.id}')">נפרע</button>`:''}<button class="iconbtn" onclick="openCheckModal('${c.id}')">עריכה</button></div></td></tr>`}
function renderCredit(){
  const future=pendingInstallments();
  const currentMonth=monthKey(todayISO()),currentYear=Number(currentMonth.slice(0,4));
  const futureYears=[...new Set(future.map(x=>x.date.slice(0,4)))].map(Number).filter(y=>Number.isFinite(y)&&y>=currentYear);
  const maxYear=Math.max(currentYear+1,...futureYears,currentYear);
  const years=Array.from({length:maxYear-currentYear+1},(_,i)=>String(currentYear+i));
  if(!['rolling12','all',...years].includes(String(creditView)))creditView='rolling12';
  let monthKeys=[],forecastTitle='',forecastHint='תשלום שמועדו עבר יורד אוטומטית מהתחזית ומהמונה שנותר';
  if(creditView==='rolling12'){
    monthKeys=Array.from({length:12},(_,i)=>monthKey(addMonthsISO(`${currentMonth}-01`,i)));
    forecastTitle='תחזית 12 חודשים קדימה';
    forecastHint+=` · ${monthLabel(monthKeys[0])}–${monthLabel(monthKeys[monthKeys.length-1])}`;
  }else if(creditView==='all'){
    monthKeys=[...new Set(future.map(x=>monthKey(x.date)).filter(Boolean))].sort();
    forecastTitle='כל חיובי האשראי העתידיים';
    forecastHint+=' · מוצגים כל החודשים שבהם יש חיוב עתידי, ללא הגבלת שנה';
  }else{
    monthKeys=Array.from({length:12},(_,i)=>`${creditView}-${String(i+1).padStart(2,'0')}`);
    forecastTitle=`תחזית ${creditView}`;
  }
  const months=monthKeys.map(k=>{const inst=future.filter(x=>monthKey(x.date)===k);return {k,inst,total:inst.reduce((a,x)=>a+x.amount,0)}});
  const monthCards=months.length?months.map(m=>creditMonthCard(m)).join(''):'<div class="empty">אין חיובי אשראי עתידיים.</div>';
  document.getElementById('content').innerHTML=`<div class="toolbar"><select aria-label="טווח תחזית אשראי" onchange="creditView=this.value;renderCredit()"><option value="rolling12" ${creditView==='rolling12'?'selected':''}>12 חודשים קדימה</option><option value="all" ${creditView==='all'?'selected':''}>כל השנים</option><optgroup label="לפי שנה">${years.map(y=>`<option value="${y}" ${creditView===y?'selected':''}>${y}</option>`).join('')}</optgroup></select><span class="stat-pill">עסקאות עם יתרה: ${state.credits.filter(x=>x.active&&creditProgress(x).remainingCount>0).length}</span><span class="stat-pill">סה״כ עתידי: ${money(future.reduce((a,x)=>a+x.amount,0))}</span><span class="stat-pill">ניקוי אוטומטי: לא פעיל + 60 יום</span><span style="flex:1"></span>${bulkControls('credits')}<button class="btn primary" onclick="openCreditModal()">+ עסקת אשראי</button></div><section class="section"><div class="section-head"><div><h3>${forecastTitle}</h3><div class="muted">${forecastHint}</div></div></div><div class="section-body"><div class="month-cards">${monthCards}</div></div></section><section class="section" style="margin-top:16px"><div class="section-head"><div><h3>עסקאות אשראי</h3><div class="muted">מספר התשלומים שנותרו מחושב לפי התאריך — ללא סימון ידני</div></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('credits')}<th>כרטיס</th><th>תיאור</th><th>סכום כולל</th><th>התקדמות</th><th>תשלום הבא</th><th>יתרה עתידית</th><th>מצב</th><th></th></tr></thead><tbody>${state.credits.map(cr=>{const p=creditProgress(cr),pct=cr.installments?Math.min(100,(p.completedCount/cr.installments)*100):0;const status=!cr.active?'לא פעיל':p.complete?'הסתיים':'פעיל';return `<tr data-bulk-collection="credits" data-bulk-id="${esc(cr.id)}" class="${bulkSelected.has(cr.id)?'bulk-selected-row':''}">${bulkCell('credits',cr.id)}<td><b>${esc(cr.card)}</b><div class="muted">${esc(cr.account)}</div></td><td>${esc(cr.description)||'—'}</td><td class="amount">${money(cr.totalAmount)}</td><td><div class="credit-progress"><b>נותרו ${p.remainingCount} מתוך ${cr.installments}</b><div class="progress-mini"><div class="progress-track"><i style="width:${pct}%"></i></div><div class="muted" style="margin-top:4px">בוצעו ${p.completedCount}</div></div></div></td><td>${p.next?`${dateFmt(p.next.date)}<div class="muted">תשלום ${p.next.part}/${p.next.totalParts} · ${money(p.next.amount)}</div>`:'—'}</td><td class="amount">${money(p.remainingAmount)}</td><td><span class="badge ${status==='פעיל'?'green':status==='הסתיים'?'blue':''}">${status}</span></td><td><button class="iconbtn" onclick="openCreditModal('${cr.id}')">עריכה</button></td></tr>`}).join('')}</tbody></table></div></section>`;
  syncBulkUi('credits')
}
function creditMonthCard(m){const cur=monthKey(todayISO())===m.k,past=m.k<monthKey(todayISO());const by={};m.inst.forEach(x=>by[x.card]=(by[x.card]||0)+x.amount);return `<div class="month-card ${cur?'current':''}"><h4>${monthLabel(m.k)} ${cur?'<span class="badge blue">החודש</span>':past?'<span class="badge">עבר</span>':''}</h4>${Object.entries(by).length?Object.entries(by).map(([card,v])=>`<div class="metric"><span>${esc(card)}</span><b>${money(v)}</b></div>`).join(''):`<div class="muted">${past?'אין חיובים עתידיים':'אין חיובים'}</div>`}<div class="total">סה״כ ${money(m.total)}</div></div>`}
function renderCash(){const rows=[...state.cash].sort((a,b)=>(b.date||'').localeCompare(a.date||''));document.getElementById('content').innerHTML=`<div class="grid kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px">${kpi('יתרת מזומן',cashBalance(),'#e8f4f2','#147d73','מחושב מכל התנועות')}${kpi('כניסות',state.cash.filter(x=>x.amount>0).reduce((a,x)=>a+x.amount,0),'#eaf5ee','#39835a','סה״כ תנועות חיוביות')}${kpi('יציאות / התאמות',Math.abs(state.cash.filter(x=>x.amount<0).reduce((a,x)=>a+x.amount,0)),'#fff0de','#d88422','סה״כ תנועות שליליות')}</div><section class="section"><div class="section-head"><div><h3>תנועות מזומן</h3><div class="muted">כל שינוי נשמר כתנועה — אין צורך לשנות יתרה ידנית</div></div><div class="bulk-actions">${bulkControls('cash')}<button class="btn primary" onclick="openCashModal()">+ תנועה חדשה</button></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('cash')}<th>תאריך</th><th>סוג</th><th>תיאור</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-bulk-collection="cash" data-bulk-id="${esc(r.id)}" class="${bulkSelected.has(r.id)?'bulk-selected-row':''}">${bulkCell('cash',r.id)}<td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td><b>${esc(r.description)}</b></td><td class="amount" style="color:${r.amount<0?'#b5443c':'#2f7952'}">${money(r.amount)}</td><td class="muted">${esc(r.note)||'—'}</td><td><button class="iconbtn" onclick="openCashModal('${r.id}')">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>`;syncBulkUi('cash')}
function renderBank(){
  const bank=bankCurrentBalance(),cycle=bankNextCycleCommitments(),after=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth);
  const targetExpenseRows=cycle.targetExpenseRows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const allRows=[...state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||''));
  const autoDeposits=bankDerivedCheckDeposits();
  const staleTotal=cycle.elapsedCredit+cycle.elapsedExpenses;
  document.getElementById('content').innerHTML=`
  <div class="bank-balance-card">
    <div class="bank-entry">
      <label>עובר ושב בבנק — יתרה מעודכנת</label>
      <div class="bank-input-row"><input id="bankBalanceInput" type="number" step="1" inputmode="numeric" placeholder="הקלד יתרת עו״ש" value="${bank===null?'':bank}"><button class="btn primary" onclick="saveBankBalance()">שמור צילום מצב</button></div>
      <small>${state.bank?.updatedAt?`צילום ידני אחרון: ${dateFmt(bankAsOfDate())} · ${new Date(state.bank.updatedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`:'היתרה טרם הוזנה.'}${autoDeposits.length?` · נוספו מאז אוטומטית ${autoDeposits.length} הפקדות צקים (${money(autoDeposits.reduce((a,x)=>a+x.amount,0))})`:''}</small>
    </div>
    <div class="bank-mini"><div class="bank-label">אשראי במחזור הקרוב</div><div class="bank-value">${money(cycle.nextCreditTotal)}</div><div class="muted">${cycle.nextCreditRows.length?`חיוב אחד קדימה לכל כרטיס · ${cycleLabel}`:'אין חיובי אשראי עתידיים'}</div></div>
    <div class="bank-mini"><div class="bank-label">הוצאות למחזור הקרוב</div><div class="bank-value">${money(targetExpenseRows.reduce((a,x)=>a+num(x.amount),0))}</div><div class="muted">הוצאות של ${cycleLabel} בלבד</div></div>
    <div class="bank-mini ${after!==null&&after>=0?'positive':'warning'}"><div class="bank-label">עו״ש אחרי המחזור הקרוב</div><div class="bank-value">${formatNullableMoney(after)}</div><div class="muted">צילום יתרה פחות חיובים שעברו מאז + מחזור האשראי הבא</div></div>
  </div>
  ${staleTotal>0?`<div class="notice warn" style="margin-bottom:16px"><b>הצילום הידני של העו״ש ישן ביחס להיום.</b> לצורך חישוב נכון נגרעו גם חיובים שכבר עברו מאז הצילום בסך ${money(staleTotal)}. מומלץ לעדכן מדי פעם את היתרה לפי הבנק.</div>`:''}
  <div class="grid two">
    <section class="section"><div class="section-head"><div><h3>הוצאות מחזור ${cycleLabel}</h3><div class="muted">מחזור אחד בלבד — לא מכפילים הוצאות קבועות לכל העתיד</div></div><button class="btn primary" onclick="openExpenseModal()">+ הוצאה חדשה</button></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${targetExpenseRows.length?targetExpenseRows.map(r=>`<tr><td><b>${esc(r.description)}</b><div class="muted">${esc(r.account)}</div></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${r.recurring!==false?'green':''}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button class="iconbtn" onclick="openExpenseModal('${r.id}')">עריכה</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">אין הוצאות במחזור הזה.</div></td></tr>'}</tbody></table></div></section>
    <section class="section"><div class="section-head"><div><h3>חיובי האשראי הקרובים</h3><div class="muted">תמיד חיוב אחד קדימה לכל כרטיס; אחרי שעובר חיוב, הבא נכנס אוטומטית</div></div></div><div class="section-body"><div class="alert-list">${cycle.nextCreditRows.length?cycle.nextCreditRows.map(x=>`<div class="alert" style="--c:#638f87"><div><b>${esc(x.card)} — ${money(x.amount)}</b><small>${dateFmt(x.date)} · תשלום ${x.part}/${x.totalParts} · ${esc(x.description)||'עסקת אשראי'}</small></div></div>`).join(''):'<div class="empty">אין חיובי אשראי עתידיים.</div>'}</div></div></section>
  </div>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3><div class="muted">הוצאות חוזרות נשמרות פעם אחת ומחושבות אוטומטית לפי חודש</div></div></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${allRows.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${esc(r.account)}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button class="iconbtn" onclick="openExpenseModal('${r.id}')">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>
  <div class="net-summary">
    <div class="net-mini"><span>עו״ש מעודכן</span><b>${formatNullableMoney(long.bank)}</b></div>
    <div class="net-mini"><span>כל האשראי שנותר</span><b>− ${money(long.credit)}</b></div>
    <div class="net-mini"><span>הוצאות חודש אחד</span><b>− ${money(long.expenses)}</b><small>${monthLabel(long.targetMonth)}</small></div>
    <div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div>
    <div class="net-total"><span>מאזן כולל נטו</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש − כל האשראים העתידיים − חודש הוצאות + קופה</small></div>
  </div>`}
async function saveBankBalance(){const el=document.getElementById('bankBalanceInput');if(!el||el.value==='')return toast('יש להזין יתרת עו״ש');if(connectionMode==='supabase'){if(sharedChecksBusy||sharedChecksHaveLocalWork())return toast('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');const synced=await syncSharedChecksFromCloud({quiet:true,required:true});if(!synced||sharedChecksBusy||sharedChecksHaveLocalWork())return toast('צילום היתרה נעצר: לא ניתן לאמת שהצקים מסונכרנים כרגע. נסה שוב לאחר שהענן מסונכרן.')}const observedSeq=sharedChecksObservedSequence();state.bank={...state.bank,currentBalance:wholeMoney(el.value),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedSeq,adjustments:[]};saveState('יתרת העו״ש נשמרה כצילום מצב חדש')}
function renderExpenses(){renderBank()}
function renderSettings(){
  const b=serverInfo.backups||[],cloudActive=connectionMode==='supabase',cloudReady=supaConfigured(),email=localStorage.getItem(SUPA_EMAIL_KEY)||'';
  document.getElementById('content').innerHTML=`
  <div class="grid two">
    <section class="section"><div class="section-head"><div><h3>כרטיסי אשראי</h3><div class="muted">יום החיוב משמש כברירת מחדל לעסקה חדשה</div></div></div><div class="section-body"><table class="settings-table"><thead><tr><th>כרטיס</th><th>חשבון</th><th>יום חיוב</th><th>פעיל</th></tr></thead><tbody>${state.cards.map((c,i)=>`<tr><td><input value="${esc(c.name)}" onchange="updateCard(${i},'name',this.value)"></td><td><select onchange="updateCard(${i},'account',this.value)"><option ${c.account==='עסקי'?'selected':''}>עסקי</option><option ${c.account==='ביתי'?'selected':''}>ביתי</option></select></td><td><input type="number" min="1" max="28" step="1" inputmode="numeric" value="${c.chargeDay}" onchange="updateCard(${i},'chargeDay',Number(this.value))"></td><td><select onchange="updateCard(${i},'active',this.value==='כן')"><option ${c.active?'selected':''}>כן</option><option ${!c.active?'selected':''}>לא</option></select></td></tr>`).join('')}</tbody></table></div></section>
    <section class="section"><div class="section-head"><div><h3>גיבוי ומקור נתונים</h3><div class="muted">${cloudActive?'הקופה פועלת כרגע מהענן':'הקופה פועלת כרגע מקובץ נייד'}</div></div></div><div class="section-body">
      <div class="notice"><b>${cloudActive?'Supabase מחובר':'אחסון מקומי מחובר'}.</b> ${cloudActive?'נתוני הקופה נשמרים ב־kupa_documents עם Revision עצמאי; הצקים נשמרים ב־shared_checks_documents עם Revision נפרד. שינוי באחד אינו גורר כתיבה של השני.':`הנתונים נשמרים ב־<code>${esc(connectionMode==='directory'?'data\\'+DATA_FILE:serverInfo.databaseFile||DATA_FILE)}</code>.`}</div>
      <div class="statline" style="margin-top:12px"><span class="stat-pill">Revision ${dbRevision}</span><span class="stat-pill">שמירה אחרונה: ${serverInfo.lastSavedAt?new Date(serverInfo.lastSavedAt).toLocaleString('he-IL'):'—'}</span><span class="stat-pill">Schema ${serverInfo.schemaVersion||6}</span></div><div class="soft-note" style="margin-top:12px"><b>גיבוי אוטומטי למחשב:</b> ${backupsDirHandle?`פעיל בתיקיית backups של ${esc(backupRootDirHandle?.name||'התיקייה המחוברת')}.`:'לא חוברה כרגע תיקיית גיבוי מקומית.'} נוצר לכל היותר גיבוי אוטומטי אחד בכל 12 שעות ורק כשהנתונים שונים מהגיבוי האוטומטי האחרון; הקובץ נקרא מחדש ונבדק לאחר הכתיבה.</div>
      <div class="backup-actions" style="margin-top:16px"><button class="btn primary" onclick="manualBackup()">גיבוי עכשיו</button><button class="btn" onclick="downloadJsonBackup()">ייצא JSON</button><button class="btn" onclick="document.getElementById('restoreInput').click()">ייבא JSON</button><input id="restoreInput" type="file" accept="application/json,.json" hidden onchange="restoreBackup(this.files[0])"><button class="btn" onclick="switchFolder()">בחר תיקיית נתונים מקומית</button><button class="btn" onclick="chooseBackupFolder()">חבר תיקיית גיבוי</button><button class="btn" onclick="exportCSV('checks')">צקים CSV</button><button class="btn" onclick="exportCSV('credits')">אשראי CSV</button></div>
      ${backupsDirHandle?`<div style="margin-top:18px"><b>גיבויים מקומיים אחרונים:</b><div class="muted" style="margin-top:7px;line-height:1.9">${b.length?b.slice(0,10).map(x=>`${esc(x.name)} · ${Math.max(1,Math.round(x.size/1024))} KB`).join('<br>'):'עדיין אין גיבויים'}</div></div>`:''}
    </div></section>
  </div>
  <section class="section cloud-section" style="margin-top:16px"><div class="section-head"><div><h3>סנכרון ענן Supabase</h3><div class="muted">לכמה מחשבים ולאתר — בלי שרת מקומי ובלי סנכרון קבצים</div></div><span class="badge ${cloudActive?'green':cloudReady?'blue':'red'}">${cloudActive?'מחובר':cloudReady?'מוכן להגדרה':'חסר config'}</span></div><div class="section-body">
    ${cloudActive?`
      <div class="cloud-status-grid"><div><span>חשבון</span><b>${esc(email)||'מחובר'}</b></div><div><span>פרויקט</span><b style="direction:ltr">${esc(supaProjectRef())}</b></div><div><span>גרסה בענן</span><b>${dbRevision}</b></div></div>
      <div class="backup-actions" style="margin-top:16px"><button class="btn primary" onclick="loadSupabaseState()">רענן מהענן</button><button class="btn" onclick="downloadJsonBackup()">הורד גיבוי מקומי</button><button class="btn danger" onclick="logoutSupabase()">התנתק מהמחשב הזה</button></div>
      <div class="notice ${cloudConflictPending?'danger':''}" style="margin-top:14px"><b>${cloudConflictPending?'יש שינוי מקומי שממתין לטיפול.':'סנכרון בטוח פעיל.'}</b> מחשבים מחוברים נבדקים אוטומטית בערך כל 12 שניות ובחזרה לטאב. אם שני מחשבים שינו רשומות שונות, המערכת ממזגת; אם אותה רשומה שונתה בשניהם, היא עוצרת ולא מוחקת אף שינוי. במצב Offline השינויים נשמרים בתור מקומי ומנסים להסתנכרן אוטומטית כשחוזרת הרשת.</div>
      <div class="backup-actions" style="margin-top:10px"><button class="btn" onclick="cloudPoll()">בדוק וסנכרן עכשיו</button>${cloudConflictPending?`<button class="btn orange" onclick="downloadJsonBackup()">ייצא קודם את השינוי המקומי</button><button class="btn danger" onclick="discardCloudPendingAndLoadRemote()">וותר על המקומי וטען ענן</button>`:''}</div>
    `:`
      <div class="notice"><b>מומלץ למעבר לכמה מחשבים.</b> הענן הוא מקור נתונים מרכזי; אין העתקת תיקיות ואין “מי שמר אחרון ניצח”. הקופה המקומית נשארת זמינה כגיבוי/מצב חלופי.</div>
      <div class="backup-actions" style="margin-top:16px"><button class="btn primary" ${cloudReady?'':'disabled'} onclick="enableCloudFromCurrentState()">הפעל ענן והעלה את הקופה הנוכחית</button><button class="btn" ${cloudReady?'':'disabled'} onclick="openSupabaseLoginModal('open')">פתח קופה קיימת מהענן</button></div>
      <div class="soft-note" style="margin-top:14px">הפרויקט שמוגדר כרגע: <code>${esc(supaProjectRef())}</code>. בהתקנה חדשה יש להריץ את <code>supabase/setup.sql</code> וגם את <code>netunim-orders/supabase/shared/setup.sql</code>. במעבר מהמערכת הקיימת יש להריץ את <code>netunim-orders/supabase/shared/cutover.sql</code> בזמן חלון ההקפאה, ורק לאחר הצלחת האימות להעלות את שתי גרסאות האתר החדשות. קובץ <code>supabase/config.js</code> מכיל רק Project URL ו־Publishable Key — לא מפתח סודי.</div>
    `}
  </div></section>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>נתוני מערכת</h3><div class="muted">לבדיקה מהירה</div></div></div><div class="section-body"><div class="statline"><span class="stat-pill">${state.checks.length} צקים</span><span class="stat-pill">${state.credits.length} עסקאות אשראי</span><span class="stat-pill">${state.cash.length} תנועות מזומן</span><span class="stat-pill">${state.expenses.length} הוצאות</span><span class="stat-pill">עו״ש: ${formatNullableMoney(bankCurrentBalance())}</span><span class="stat-pill">השפעת אירועי צקים מאז צילום הבנק: ${money(bankCheckEffectsTotal())}</span></div></div></section>`}
function modalFormSnapshot(){const root=document.getElementById('modal');if(!root)return '';return JSON.stringify([...root.querySelectorAll('input,select,textarea')].map(el=>({id:el.id||'',field:el.dataset.seriesField||'',type:el.type||'',value:el.value,checked:el.type==='checkbox'||el.type==='radio'?el.checked:null})))}
function armModalDraftGuard(message='הנתונים שהקלדת עדיין לא נשמרו. לצאת ולמחוק את הטיוטה?'){modalDraftGuard={snapshot:modalFormSnapshot(),message}}
function modalHasUnsavedDraft(){return !!modalDraftGuard&&modalFormSnapshot()!==modalDraftGuard.snapshot}
function clearModalDraftGuard(){modalDraftGuard=null}
function modal(title,body,saveLabel,saveFn,deleteFn){clearModalDraftGuard();document.getElementById('modal').innerHTML=`<div class="modal-head"><h3>${title}</h3><button class="close" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn primary" onclick="${saveFn}">${saveLabel}</button><button class="btn" onclick="closeModal()">ביטול</button>${deleteFn?`<button class="btn danger" style="margin-right:auto" onclick="${deleteFn}">מחיקה</button>`:''}</div>`;document.getElementById('modalBackdrop').classList.add('open')}
function closeModal(force=false){if(!force&&modalHasUnsavedDraft()&&!confirm(modalDraftGuard.message))return false;clearModalDraftGuard();document.getElementById('modalBackdrop').classList.remove('open');return true}
function openCheckModal(id){
  if(id){
    const c=state.checks.find(x=>x.id===id);if(!c)return toast('הצק לא נמצא');
    modal('עריכת צק',`<div class="form-grid"><div class="form-group"><label>שם</label><input id="fName" value="${esc(c.name)}" autofocus></div><div class="form-group"><label>סכום</label><input id="fAmount" type="number" min="0" step="1" inputmode="numeric" value="${c.amount||''}"></div><div class="form-group"><label>תאריך פירעון</label>${checkDateEditorMarkup('fDue',c.dueDate||'',{label:'תאריך פירעון'})}<div class="check-date-hint">יום / חודש / 2 ספרות שנה</div></div><div class="form-group"><label>סטטוס</label><select id="fStatus">${['בקופה','הופקד - במעקב','נפרע','חזר','בוטל'].map(s=>`<option ${c.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="form-group"><label>מספר צק</label><input id="fNum" value="${esc(c.checkNumber)}"></div><div class="form-group"><label>תאריך הפקדה</label>${checkDateEditorMarkup('fDeposit',c.depositDate||'',{label:'תאריך הפקדה'})}<div class="check-date-hint">יום / חודש / 2 ספרות שנה</div></div><div class="form-group full"><label>הערה</label><textarea id="fNote">${esc(c.note)}</textarea></div></div>`,'שמור שינויים',`saveCheck('${id}')`,`deleteRecord('checks','${id}')`);armModalDraftGuard();return;
  }
  modal('צק חדש',`<div class="form-grid"><div class="form-group"><label>שם לקוח</label><input id="fName" autofocus></div><div class="form-group"><label>מספר צקים</label><input id="fCheckCount" class="check-count-input" type="number" min="1" max="60" step="1" inputmode="numeric" value="1" onchange="changeCheckSeriesCount()"></div><div class="form-group"><label>סטטוס</label><select id="fStatus">${['בקופה','הופקד - במעקב','נפרע','חזר','בוטל'].map(s=>`<option ${s==='בקופה'?'selected':''}>${s}</option>`).join('')}</select></div><div class="form-group"><label>תאריך הפקדה</label>${checkDateEditorMarkup('fDeposit','',{label:'תאריך הפקדה'})}<div class="check-date-hint">יום / חודש / 2 ספרות שנה</div></div><div class="check-series-wrap"><div class="check-series-head"><span>#</span><span>תאריך פירעון</span><span>סכום</span><span>מספר צק</span></div><div id="checkSeriesRows"></div></div><div class="check-series-note">ממלאים את השורה הראשונה ובוחרים מספר צקים. השורות הבאות נוצרות חודש אחר חודש באותו יום ובאותו סכום. אפשר לשנות ידנית כל תאריך, סכום או מספר צק לפני השמירה. בשנה מקלידים רק שתי ספרות, למשל 26 = 2026.</div><div class="form-group full"><label>הערה</label><textarea id="fNote"></textarea></div></div>`,'הוסף צקים','saveCheckSeries()');
  renderCheckSeriesRows([{date:'',amount:'',number:'',manualDate:false,manualAmount:false,manualNumber:false}]);
  armModalDraftGuard();
}
function checkSeriesDrafts(){return [...document.querySelectorAll('#checkSeriesRows .check-series-row')].map(row=>({date:row.querySelector('[data-series-field="date"]')?.value||'',amount:row.querySelector('[data-series-field="amount"]')?.value||'',number:row.querySelector('[data-series-field="number"]')?.value.trim()||'',manualDate:row.querySelector('[data-series-field="date"]')?.dataset.manual==='1',manualAmount:row.querySelector('[data-series-field="amount"]')?.dataset.manual==='1',manualNumber:row.querySelector('[data-series-field="number"]')?.dataset.manual==='1'}))}
function nextSeriesCheckNumber(base,i){const raw=String(base||'').trim();if(!raw)return '';if(/^\d+$/.test(raw))return String(Number(raw)+i).padStart(raw.length,'0');return ''}
function renderCheckSeriesRows(rows){const host=document.getElementById('checkSeriesRows');if(!host)return;host.innerHTML=rows.map((r,i)=>`<div class="check-series-row"><div class="check-series-index">${i+1}</div>${checkDateEditorMarkup('',r.date||'',{series:true,seriesField:'date',manual:r.manualDate,role:i===0?'series-first':'series-manual',label:`תאריך פירעון בצק ${i+1}`})}<input data-series-field="amount" data-manual="${r.manualAmount?'1':'0'}" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.amount||'')}" ${i===0?'oninput="syncCheckSeriesFromFirst()"':`oninput="markCheckSeriesManual(this)"`}><input data-series-field="number" data-manual="${r.manualNumber?'1':'0'}" value="${esc(r.number||'')}" ${i===0?'oninput="syncCheckSeriesFromFirst()"':`oninput="markCheckSeriesManual(this)"`}></div>`).join('')}
function markCheckSeriesManual(input){input.dataset.manual='1'}
function generatedCheckSeriesRow(first,i){return {date:first.date?addMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}
function changeCheckSeriesCount(){const input=document.getElementById('fCheckCount');if(!input)return;let count=Math.round(num(input.value));count=Math.min(60,Math.max(1,count||1));input.value=count;const current=checkSeriesDrafts();const first=current[0]||{date:'',amount:'',number:''};const rows=[];for(let i=0;i<count;i++)rows.push(current[i]||generatedCheckSeriesRow(first,i));renderCheckSeriesRows(rows);syncCheckSeriesFromFirst()}
function syncCheckSeriesFromFirst(){const rows=[...document.querySelectorAll('#checkSeriesRows .check-series-row')];if(!rows.length)return;const first={date:rows[0].querySelector('[data-series-field="date"]')?.value||'',amount:rows[0].querySelector('[data-series-field="amount"]')?.value||'',number:rows[0].querySelector('[data-series-field="number"]')?.value.trim()||''};rows.slice(1).forEach((row,j)=>{const i=j+1,date=row.querySelector('[data-series-field="date"]'),amount=row.querySelector('[data-series-field="amount"]'),number=row.querySelector('[data-series-field="number"]');if(date?.dataset.manual!=='1')setCheckDateValue(date,first.date?addMonthsISO(first.date,i):'');if(amount?.dataset.manual!=='1')amount.value=first.amount;if(number?.dataset.manual!=='1')number.value=nextSeriesCheckNumber(first.number,i)})}
function saveCheckSeries(){
  if(!normalizeCheckModalDates())return;
  syncCheckSeriesFromFirst();
  const name=document.getElementById('fName').value.trim(),status=document.getElementById('fStatus').value,note=document.getElementById('fNote').value.trim();let depositDate=document.getElementById('fDeposit').value||null;const drafts=checkSeriesDrafts();
  if(!name)return toast('יש למלא שם לקוח');
  if(!drafts.length)return toast('יש להוסיף לפחות צק אחד');
  const invalid=drafts.findIndex(r=>!r.date||wholeMoney(r.amount)<=0);if(invalid>=0)return toast(`יש למלא תאריך וסכום בצק ${invalid+1}`);
  const depositedStatus=['הופקד - במעקב','נפרע'].includes(status);if(depositedStatus&&!depositDate)depositDate=todayISO();
  const createdAt=todayISO(),depositedAt=depositedStatus?new Date().toISOString():null,records=drafts.map(r=>({id:uid('CHK'),name,amount:wholeMoney(r.amount),dueDate:r.date,status,depositDate,depositedAt,depositSeq:null,clearedDate:status==='נפרע'?todayISO():null,checkNumber:r.number,note,createdAt}));
  state.checks.push(...records);
  closeModal(true);saveChecksState(records.length===1?'הצק נוסף':`${records.length} צקים נוספו`);
}
function saveCheck(id){
  if(!normalizeCheckModalDates())return;
  const oldRec=clone(state.checks.find(x=>x.id===id));if(!oldRec)return toast('הצק לא נמצא');
  const rec={id,name:document.getElementById('fName').value.trim(),amount:wholeMoney(document.getElementById('fAmount').value),dueDate:document.getElementById('fDue').value,status:document.getElementById('fStatus').value,depositDate:document.getElementById('fDeposit').value||null,depositedAt:oldRec.depositedAt||null,depositSeq:oldRec.depositSeq||null,clearedDate:oldRec.clearedDate||null,checkNumber:document.getElementById('fNum').value.trim(),note:document.getElementById('fNote').value.trim(),createdAt:oldRec.createdAt||todayISO()};
  if(!rec.name||!rec.amount||!rec.dueDate)return toast('יש למלא שם, סכום ותאריך');
  const wasDeposited=['הופקד - במעקב','נפרע'].includes(oldRec.status),isDeposited=['הופקד - במעקב','נפרע'].includes(rec.status);if(isDeposited&&!rec.depositDate)rec.depositDate=todayISO();if(isDeposited&&!wasDeposited){rec.depositedAt=new Date().toISOString();rec.depositSeq=null}if(rec.status==='נפרע'&&!rec.clearedDate)rec.clearedDate=todayISO();if(rec.status!=='נפרע')rec.clearedDate=null;
  state.checks[state.checks.findIndex(x=>x.id===id)]=rec;
  closeModal(true);saveChecksState('הצק עודכן');
}
function markDeposited(id){const c=state.checks.find(x=>x.id===id);if(!c||c.status==='הופקד - במעקב')return;c.status='הופקד - במעקב';c.depositDate=todayISO();c.depositedAt=new Date().toISOString();c.depositSeq=null;c.clearedDate=null;saveChecksState('הצק סומן כהופקד')}
function markCleared(id){const c=state.checks.find(x=>x.id===id);if(!c)return;const wasDeposited=['הופקד - במעקב','נפרע'].includes(c.status);c.status='נפרע';c.clearedDate=todayISO();if(!c.depositDate)c.depositDate=todayISO();if(!wasDeposited){c.depositedAt=new Date().toISOString();c.depositSeq=null}saveChecksState('הצק סומן כנפרע')}
function openCreditModal(id){const cr=id?state.credits.find(x=>x.id===id):{account:'עסקי',card:state.cards.find(x=>x.active)?.name||'',description:'',transactionDate:todayISO(),totalAmount:'',installments:1,firstChargeDate:'',active:true,note:''};const defaultFirst=cr.firstChargeDate||nextChargeDate(cr.card,cr.transactionDate);modal(id?'עריכת עסקת אשראי':'עסקת אשראי חדשה',`<div class="form-grid"><div class="form-group"><label>חשבון</label><select id="cAccount"><option ${cr.account==='עסקי'?'selected':''}>עסקי</option><option ${cr.account==='ביתי'?'selected':''}>ביתי</option></select></div><div class="form-group"><label>כרטיס</label><select id="cCard" onchange="prefillChargeDate()">${state.cards.filter(x=>x.active||x.name===cr.card).map(c=>`<option ${c.name===cr.card?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="form-group full"><label>תיאור</label><input id="cDesc" value="${esc(cr.description)}" placeholder="למשל: ספק פלוני"></div><div class="form-group"><label>תאריך עסקה</label><input id="cTx" type="date" value="${cr.transactionDate||todayISO()}" onchange="prefillChargeDate()"></div><div class="form-group"><label>תאריך חיוב ראשון</label><input id="cFirst" type="date" value="${defaultFirst}"></div><div class="form-group"><label>סכום כולל</label><input id="cTotal" type="number" step="1" inputmode="numeric" min="0" value="${cr.totalAmount||''}"></div><div class="form-group"><label>מספר תשלומים</label><input id="cParts" type="number" min="1" max="60" step="1" inputmode="numeric" value="${cr.installments||1}"></div><div class="form-group"><label>פעיל</label><select id="cActive"><option ${cr.active?'selected':''}>כן</option><option ${!cr.active?'selected':''}>לא</option></select></div><div class="form-group full"><label>הערה</label><textarea id="cNote">${esc(cr.note)}</textarea></div><div class="form-group full"><div class="notice">אפשר לשנות ידנית את תאריך החיוב הראשון. שאר התשלומים מחושבים חודש אחר חודש, וכל תשלום שמועדו עבר יורד אוטומטית ממספר התשלומים שנותרו ומהתחזית העתידית.</div></div></div>`,id?'שמור שינויים':'הוסף עסקה',`saveCredit('${id||''}')`,id?`deleteRecord('credits','${id}')`:null);armModalDraftGuard()}
function nextChargeDate(cardName,tx){const card=state.cards.find(c=>c.name===cardName);if(!tx)return '';const d=dObj(tx),day=card?.chargeDay||10;let y=d.getFullYear(),m=d.getMonth();if(d.getDate()>day)m++;const x=new Date(y,m,1);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return localISO(x)}
function prefillChargeDate(){const tx=document.getElementById('cTx').value,card=document.getElementById('cCard').value;document.getElementById('cFirst').value=nextChargeDate(card,tx)}
function saveCredit(id){const rec={id:id||uid('CR'),account:document.getElementById('cAccount').value,card:document.getElementById('cCard').value,description:document.getElementById('cDesc').value.trim(),transactionDate:document.getElementById('cTx').value,totalAmount:wholeMoney(document.getElementById('cTotal').value),installments:Number(document.getElementById('cParts').value),firstChargeDate:document.getElementById('cFirst').value,active:document.getElementById('cActive').value==='כן',note:document.getElementById('cNote').value.trim(),createdAt:id?state.credits.find(x=>x.id===id)?.createdAt:todayISO()};if(!rec.card||!rec.totalAmount||!rec.installments||!rec.firstChargeDate)return toast('יש למלא כרטיס, סכום, תשלומים וחיוב ראשון');if(id)state.credits[state.credits.findIndex(x=>x.id===id)]=rec;else state.credits.push(rec);closeModal(true);saveState(id?'העסקה עודכנה':'העסקה נוספה')}
function openCashModal(id){const r=id?state.cash.find(x=>x.id===id):{date:todayISO(),type:'הכנסה',description:'',amount:'',note:''};modal(id?'עריכת תנועת מזומן':'תנועת מזומן חדשה',`<div class="form-grid"><div class="form-group"><label>תאריך</label><input id="mDate" type="date" value="${r.date||todayISO()}"></div><div class="form-group"><label>סוג</label><select id="mType">${['יתרת פתיחה / ספירה','הכנסה','הוצאה','התאמה'].map(s=>`<option ${r.type===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="form-group full"><label>תיאור</label><input id="mDesc" value="${esc(r.description)}"></div><div class="form-group"><label>סכום</label><input id="mAmount" type="number" step="1" inputmode="numeric" value="${r.amount||''}"></div><div class="form-group full"><label>הערה</label><textarea id="mNote">${esc(r.note)}</textarea></div><div class="form-group full"><div class="notice warn">להוצאה יש להזין סכום שלילי, לדוגמה ‎-1,200.</div></div></div>`,id?'שמור':'הוסף תנועה',`saveCash('${id||''}')`,id?`deleteRecord('cash','${id}')`:null);armModalDraftGuard()}
function saveCash(id){const rec={id:id||uid('CASH'),date:document.getElementById('mDate').value,type:document.getElementById('mType').value,description:document.getElementById('mDesc').value.trim(),amount:wholeMoney(document.getElementById('mAmount').value),note:document.getElementById('mNote').value.trim()};if(!rec.date||!rec.amount)return toast('יש למלא תאריך וסכום');if(id)state.cash[state.cash.findIndex(x=>x.id===id)]=rec;else state.cash.push(rec);closeModal(true);saveState('תנועת המזומן נשמרה')}
function openExpenseModal(id){const r=id?state.expenses.find(x=>x.id===id):{description:'',account:'עסקי',amount:'',date:todayISO(),type:'חיוב קבוע',recurring:true,active:true,note:''};modal(id?'עריכת הוצאה':'הוצאה חדשה',`<div class="form-grid"><div class="form-group full"><label>תיאור</label><input id="eDesc" value="${esc(r.description)}"></div><div class="form-group"><label>חשבון</label><select id="eAccount"><option ${r.account==='עסקי'?'selected':''}>עסקי</option><option ${r.account==='ביתי'?'selected':''}>ביתי</option></select></div><div class="form-group"><label>סכום</label><input id="eAmount" type="number" step="1" inputmode="numeric" min="0" value="${r.amount||''}"></div><div class="form-group"><label>${r.recurring!==false?'תאריך בסיס / יום חיוב':'תאריך חיוב'}</label><input id="eDate" type="date" value="${r.date||todayISO()}"></div><div class="form-group"><label>סוג</label><input id="eType" value="${esc(r.type)}"></div><div class="form-group"><label>חוזרת כל חודש?</label><select id="eRecurring"><option value="כן" ${r.recurring!==false?'selected':''}>כן</option><option value="לא" ${r.recurring===false?'selected':''}>לא</option></select></div><div class="form-group"><label>פעיל</label><select id="eActive"><option ${r.active?'selected':''}>כן</option><option ${!r.active?'selected':''}>לא</option></select></div><div class="form-group full"><label>הערה</label><textarea id="eNote">${esc(r.note)}</textarea></div><div class="form-group full"><div class="soft-note">בהוצאה חוזרת, היום שבתאריך הבסיס משמש כיום החיוב בכל חודש. לדוגמה: 15/06 ישמש כחיוב ב־15 בכל חודש.</div></div></div>`,id?'שמור':'הוסף הוצאה',`saveExpense('${id||''}')`,id?`deleteRecord('expenses','${id}')`:null);armModalDraftGuard()}
function saveExpense(id){const rec={id:id||uid('EXP'),description:document.getElementById('eDesc').value.trim(),account:document.getElementById('eAccount').value,amount:wholeMoney(document.getElementById('eAmount').value),date:document.getElementById('eDate').value,type:document.getElementById('eType').value.trim(),recurring:document.getElementById('eRecurring').value==='כן',active:document.getElementById('eActive').value==='כן',note:document.getElementById('eNote').value.trim()};if(!rec.description||!rec.amount||!rec.date)return toast('יש למלא תיאור, סכום ותאריך');if(id)state.expenses[state.expenses.findIndex(x=>x.id===id)]=rec;else state.expenses.push(rec);closeModal(true);saveState('ההוצאה נשמרה')}
function deleteRecord(collection,id){if(!confirm('למחוק את הרשומה?'))return;state[collection]=state[collection].filter(x=>x.id!==id);closeModal(true);if(collection==='checks')saveChecksState('הצק נמחק');else saveState('הרשומה נמחקה')}
function updateCard(i,k,v){const old=state.cards[i][k];state.cards[i][k]=v;if(k==='name'&&old!==v){state.credits.forEach(cr=>{if(cr.card===old)cr.card=v})}saveState('ההגדרה נשמרה')}
async function manualBackup(){
  if(!backendReady)return toast('יש לפתוח קודם מקור נתונים');
  try{const p=connectionMode==='supabase'?payloadFromState(clone(state),dbRevision):await readJsonHandle(dataFileHandle);if(backupsDirHandle){const name=await createManualBackup(p);serverInfo.backups=await listBackups();toast('נוצר גיבוי: '+name);if(currentPage==='settings')renderSettings()}else{downloadJsonBackup()}}catch(e){alert('יצירת הגיבוי נכשלה: '+e.message)}
}
function downloadJsonBackup(){const payload=payloadFromState(clone(state),dbRevision);downloadText(`kupa-backup_${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');toast('עותק גיבוי הורד')}
function downloadBackup(){manualBackup()}
function restoreBackup(file){if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const p=JSON.parse(reader.result);let d;if(p&&p._meta)d=stateFromPayload(p).state;else if(validState(p))d=normalizeState(p);else throw new Error('מבנה גיבוי לא תקין');if(!confirm('להחליף את הנתונים הנוכחיים בנתוני הגיבוי? לפני ההחלפה יישמר עותק בטיחות מקומי אם תיקיית גיבוי מחוברת. במצב ענן ישוחזרו גם נתוני הקופה וגם מאגר הצקים המשותף, כל אחד דרך Revision עצמאי.'))return;if(backupsDirHandle)await createManualBackup(payloadFromState(clone(state),dbRevision),'before-restore');state=d;if(connectionMode==='supabase'&&backendReady){await saveState('נתוני הקופה מהגיבוי שוחזרו');sharedChecksGeneration++;sharedChecksSaveRequested=true;markSharedChecksPending();persistImmediateBrowserSnapshot(state,dbRevision);const checksOk=await saveSharedChecksToCloud('הצקים מהגיבוי שוחזרו');if(!checksOk)toast('נתוני הקופה שוחזרו; הצקים נשמרו מקומית וממתינים לסנכרון')}else await saveState('הגיבוי שוחזר')}catch(e){console.error(e);alert('השחזור נעצר: '+(e.message||'קובץ הגיבוי אינו תקין'))}};reader.readAsText(file,'utf-8')}
async function switchFolder(){if(!confirm('לעבור לתיקיית קופה אחרת? השינויים הנוכחיים כבר נשמרו בקובץ המחובר.'))return;await chooseFolder()}
function exportCSV(kind){let rows;if(kind==='checks')rows=[['שם','סכום','תאריך פירעון','סטטוס','תאריך הפקדה','מספר צק','הערה'],...state.checks.map(x=>[x.name,x.amount,x.dueDate,x.status,x.depositDate||'',x.checkNumber||'',x.note||''])];else rows=[['כרטיס','חשבון','תיאור','סכום כולל','תשלומים','חיוב ראשון','פעיל','הערה'],...state.credits.map(x=>[x.card,x.account,x.description,x.totalAmount,x.installments,x.firstChargeDate,x.active?'כן':'לא',x.note||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadText(`${kind==='checks'?'checks':'credits'}_${todayISO()}.csv`,csv,'text/csv;charset=utf-8')}
function downloadText(name,text,type){const b=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
document.getElementById('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)setPage(b.dataset.page)});document.getElementById('mobileMenu').onclick=()=>document.getElementById('sidebar').classList.toggle('open');document.getElementById('quickAddCheck').onclick=()=>openCheckModal();document.getElementById('backupTop').onclick=manualBackup;document.getElementById('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function setConnectUI({title,text,note,showLast=false,showChoose=false,showFile=false,showCloud=false}){
  document.getElementById('connectTitle').textContent=title;
  document.getElementById('connectText').innerHTML=text;
  document.getElementById('connectNote').innerHTML=note||'';
  const actions=document.getElementById('connectActions');
  actions.style.display=(showLast||showChoose||showFile||showCloud)?'flex':'none';
  document.getElementById('openLastFolder').style.display=showLast?'inline-block':'none';
  document.getElementById('chooseFolder').style.display=showChoose?'inline-block':'none';
  document.getElementById('chooseDataFile').style.display=showFile?'inline-block':'none';
  document.getElementById('openCloud').style.display=showCloud?'inline-block':'none';
}
function showFirstRun(){
  configureCloudConnectButton('פתח קופה מהענן','open');
  setConnectUI({title:'פתיחת קופת העסק',text:'אפשר לעבוד מתיקייה מקומית ניידת או לפתוח את אותה קופה מהענן Supabase.',note:`לתיקייה מקומית בוחרים פעם אחת את תיקיית <b>ניהול_קופה_ניידת</b>. לענן מתחברים פעם אחת בכל מחשב; לאחר התחברות מוצלחת ה-Session נשמרת ומתרעננת אוטומטית. ${supaConfigured()?`פרויקט: <b>${esc(supaProjectRef())}</b>.`:''}`,showChoose:true,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
}
function showRememberedFolderPrompt(note='הדפדפן דורש אישור מחדש לגישה לתיקייה השמורה.'){
  configureCloudConnectButton('פתח קופה מהענן','open');
  setConnectUI({title:'הקופה השמורה מוכנה',text:'התיקייה כבר שמורה. לחץ פעם אחת כדי לאשר את הגישה מחדש — אין צורך לבחור אותה מחדש.',note,showLast:true,showChoose:true,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
}
async function tryAutoOpenRemembered(){
  const last=await getRememberedHandle();
  if(!last)return false;
  try{
    const permission=await last.queryPermission?.({mode:'readwrite'});
    if(permission==='granted'){
      rootDirHandle=last;connectionMode='directory';dataFileHandle=await ensureDirectoryFile(last);await loadState();document.getElementById('connectScreen').style.display='none';render();return true;
    }
    showRememberedFolderPrompt();
    return true;
  }catch(e){console.error(e);showRememberedFolderPrompt('נמצאה תיקייה שמורה, אך לא ניתן היה להתחבר אליה אוטומטית. נסה לפתוח אותה מחדש.');return true}
}
function runtimeSelfCheck(){
  const required=['assertValidCloudState','normalizeSharedChecks','prepareKupaCloudState','saveChecksState','saveSharedChecksToCloud','syncSharedChecksFromCloud','pollSharedChecks','num','money','dateFmt','todayISO','localISO','dObj','daysFromToday','monthKey','monthLabel','addMonthsISO','checkDateParts','checkDateEditorMarkup','checkDateEditorValue','commitCheckDateEditor','setCheckDateValue','normalizeCheckModalDates','uid','activeChecks','depositedChecks','cashBalance','checksBalance','depositedBalance','checkUrgency','rawCreditSchedule','creditSchedule','inactiveCreditExpired','creditProgress','pendingInstallments','allInstallments','monthSumInstallments','expenseOccurrencesForMonth','monthSumExpenses','bankBaseBalance','bankAdjustments','bankAdjustmentsTotal','bankCurrentBalance','bankAsOfDate','bankDerivedCheckDeposits','bankCheckEffectsTotal','pendingSharedCheckBankDelta','sharedChecksObservedSequence','normalizeSharedBankEvents','monthKeysBetween','nextCreditCycle','modalFormSnapshot','armModalDraftGuard','modalHasUnsavedDraft','clearModalDraftGuard','openLastFolder'];
  const missing=required.filter(name=>typeof globalThis[name]!=='function');
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
  if(!primaryTab){showSecondaryTabGuard();return}
  await requestPersistentBrowserStorage();
  document.getElementById('chooseFolder').onclick=chooseFolder;
  document.getElementById('chooseDataFile').onclick=chooseDataFile;
  document.getElementById('openLastFolder').onclick=openLastFolder;
  document.getElementById('openCloud').onclick=handleCloudConnectButton;
  if(supaConfigured())setCloudHeaderStatus('syncing','ענן: בודק…');else setCloudHeaderStatus('off','ענן: לא מוגדר');
  await restoreRememberedBackupTarget();
  await restoreSupaSession();
  sharedChecksBase=loadSharedChecksBase();sharedChecksBankEvents=loadSharedChecksBankEvents();if(sharedChecksPendingExists()){sharedChecksGeneration=Math.max(sharedChecksGeneration,1);sharedChecksSaveRequested=true}
  if(await tryAutoOpenSupabase())return;
  if(cloudAuthNoDocument){await showCloudNoDocument();return}
  if(!window.isSecureContext){
    configureCloudConnectButton('פתח קופה מהענן','open');
    setConnectUI({title:'נדרשת פתיחה ב־Chrome או Edge',text:'הדפדפן לא פתח את הקובץ כהקשר מקומי מאובטח.',note:'אפשר עדיין לפתוח קופה בענן Supabase, או לפתוח את <b>site/index.html</b> דרך HTTPS או שרת פיתוח מקומי (localhost) ב־Chrome/Edge עדכני.',showChoose:!!window.showDirectoryPicker,showFile:!window.showDirectoryPicker,showCloud:supaConfigured()});
    return;
  }
  if(await tryAutoOpenRemembered())return;
  showFirstRun();
}
window.addEventListener('pagehide',()=>{if(!primaryTab)return;persistImmediateBrowserSnapshot(state,dbRevision);if(connectionMode==='supabase'&&backendReady&&lastSavedSnapshot&&!jsonEq(prepareKupaCloudState(state),lastSavedCloudState()))stageCloudPendingLocal(prepareKupaCloudState(state),'שינוי לפני סגירה',dbRevision,lastSavedCloudState(),localGeneration,false);if(connectionMode==='supabase'&&sharedChecksHaveLocalWork())markSharedChecksPending()});
window.addEventListener('beforeunload',e=>{if(!primaryTab)return;const unsavedKupa=backendReady&&lastSavedSnapshot&&!jsonEq(prepareKupaCloudState(state),lastSavedCloudState()),unsavedChecks=connectionMode==='supabase'&&sharedChecksHaveLocalWork();if(!unsavedKupa&&!unsavedChecks&&!cloudPendingExistsSync())return;persistImmediateBrowserSnapshot(state,dbRevision);if(connectionMode==='supabase'&&unsavedKupa&&lastSavedSnapshot)stageCloudPendingLocal(prepareKupaCloudState(state),'שינוי לפני סגירה',dbRevision,lastSavedCloudState(),localGeneration,false);if(unsavedChecks)markSharedChecksPending();e.preventDefault();e.returnValue=''});
boot();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));}
