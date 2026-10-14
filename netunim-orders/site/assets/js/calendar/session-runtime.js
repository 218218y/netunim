// @ts-check
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createCalendarOperationFlight} from './operation-flight.js';
import {googleCalendarConfig} from './config.js';
import {consumeCalendarOAuthReturn,calendarOAuthReturnUrl} from '../platform/calendar-oauth-return.js';

/** @typedef {{owner:string,signal:AbortSignal,assertCurrent:()=>void}} CalendarDisplayAuthority */
/** @typedef {{assertCurrent:()=>void,signal:AbortSignal}} RequestScope */
/** @typedef {{id:string,primary?:boolean,accessRole?:string}} CalendarIdentity */
/** @typedef {{key:string,startKey:string,endKey:string,timeMin:string,timeMax:string}} CalendarSyncRange */
/** @typedef {{key:string,owner:string,accountId:string,rangeStart:string,rangeEnd:string,fetchedAt:string,calendars:CalendarIdentity[],events:unknown[]}} CalendarSnapshot */
/** @typedef {{operations:unknown[],isCurrent:()=>boolean,isSettled:()=>boolean}} PendingReceipt */
/** @typedef {{known:boolean,autoConnect:boolean,accountId:string}} ConnectionPreference */
/** @typedef {{accessToken:string,accountId:string,expectedAccountId:string,autoConnect:boolean,accountVerified:boolean,syncing:boolean,lastError:string,queueObservationError:string,lastSyncAt:string|null}} CalendarSession */
/**
 * @typedef {object} SessionStorage
 * @property {()=>ConnectionPreference} connectionPreference
 * @property {(value:{autoConnect:boolean,accountId:string})=>void} saveConnectionPreference
 * @property {(key:string)=>Promise<unknown>} getMeta
 * @property {(key:string,value:string)=>Promise<unknown>} putMeta
 * @property {()=>Promise<unknown>} clearRangeCache
 * @property {()=>Promise<unknown[]>} listOperations
 * @property {(snapshot:CalendarSnapshot)=>Promise<unknown>} putRangeCache
 * @property {()=>Promise<PendingReceipt>} readPendingSnapshot
 * @property {(publish:(receipt:PendingReceipt)=>boolean)=>Promise<boolean>} confirmPendingSnapshot
 */
/** @typedef {{capture:()=>CalendarDisplayAuthority,checkpoint:()=>()=>void}} DisplayLifetime */
/**
 * @typedef {object} SessionDisplay
 * @property {()=>boolean} isOpen
 * @property {()=>boolean} isPrimary
 * @property {()=>void} open
 * @property {()=>CalendarSyncRange} prefetchRange
 * @property {(range:CalendarSyncRange)=>boolean} cacheCovers
 * @property {(snapshot:CalendarSnapshot)=>boolean} containsPrefetch
 * @property {(calendars:CalendarIdentity[])=>void} setCalendars
 * @property {(operations:unknown[])=>void} setPending
 * @property {()=>void} clearCache
 * @property {(snapshot:CalendarSnapshot,operations:unknown[])=>void} publish
 * @property {()=>void} render
 * @property {()=>void} status
 */
/** @typedef {Pick<ReturnType<import('./auth.js').createCalendarAuth>,'restore'|'beginConnect'|'disconnect'|'rejectToken'|'hasUsableToken'|'authRequiredError'|'configured'|'ready'|'prepare'>} SessionAuth */
/** @typedef {{listCalendars:(scope:RequestScope)=>Promise<CalendarIdentity[]>,fetchEvents:(calendars:CalendarIdentity[],range:CalendarSyncRange,scope:RequestScope)=>Promise<unknown[]>}} SessionApi */
/** @typedef {{code?:unknown,message?:unknown,status?:unknown,retryAfterMs?:unknown}} OperationError */
/** @param {unknown} error @returns {OperationError} */
function details(error){return error!==null&&typeof error==='object'?error:{}}
/** @param {unknown} error */
function stale(error){return ['CALENDAR_OPERATION_SCOPE_CHANGED','calendar_cloud_auth_required'].includes(String(details(error).code||''))}
/** @param {unknown} error @param {string} [fallback] */
function errorMessage(error,fallback=''){return String(details(error).message||fallback)}

/**
 * Owns Google connection intent, sync/reconnect flights and browser wakeups.
 * The display port publishes only inside the queue's synchronous transaction;
 * this runtime cannot acknowledge or delete a durable pending event itself.
 * @param {{session:CalendarSession,auth:SessionAuth,storage:SessionStorage,api:SessionApi,journal:{flushPending:(scope:RequestScope)=>Promise<unknown>},effects:ReturnType<import('../platform/calendar-browser-effects.js').createCalendarBrowserEffects>,authority:DisplayLifetime,display:SessionDisplay,feedback:{toast:(text:string)=>void,requestCloudLogin:()=>void}}} ports
 */
export function createCalendarSessionRuntime({session,auth,storage,api,journal,effects,authority:lifetime,display,feedback}){
  let disposed=false,started=false;
  const actions=createRuntimeTaskOwner(),reconnectFlight=createCalendarOperationFlight({isObsolete:stale});
  const createSyncFlight=/** @type {typeof createCalendarOperationFlight<boolean>} */ (createCalendarOperationFlight);
  const syncFlight=createSyncFlight({isObsolete:stale});
  const oauthReturn=consumeCalendarOAuthReturn();
  if(oauthReturn.status==='connected'){
    const previous=storage.connectionPreference();storage.saveConnectionPreference({autoConnect:true,accountId:previous.accountId});display.open();
  }else if(oauthReturn.status==='error'){
    const previous=storage.connectionPreference();storage.saveConnectionPreference({autoConnect:false,accountId:previous.accountId});session.lastError=oauthReturnError(oauthReturn.code);display.open();
  }
  const savedConnection=storage.connectionPreference();
  session.autoConnect=savedConnection.autoConnect;session.accountId=savedConnection.accountId||session.accountId;
  /** @param {()=>unknown} run */
  function wake(run){
    if(disposed)return;const assertCurrent=lifetime.checkpoint();
    void actions.run(()=>Promise.resolve().then(()=>{assertCurrent();return run()})).catch(error=>{if(!stale(error))console.error('calendar wake',error)});
  }

  /** @param {string} code */
  function oauthReturnError(code){if(code==='access_denied')return 'החיבור ל-Google בוטל או לא אושר';if(code==='state_expired')return 'בקשת החיבור ל-Google פגה. יש לנסות להתחבר שוב.';if(code==='backend_not_configured')return 'שירות Google Calendar בשרת עדיין לא הוגדר';return 'החיבור ל-Google לא הושלם. יש לנסות שוב.'}

  async function hydrateLegacyConnectionPreference(){if(savedConnection.known)return;const assertCurrent=lifetime.checkpoint();try{const accountId=String(await storage.getMeta('accountId')||'').trim();assertCurrent();if(!accountId||storage.connectionPreference().known)return;storage.saveConnectionPreference({autoConnect:true,accountId});session.autoConnect=true;session.accountId=accountId}catch(error){if(!stale(error))console.warn('calendar connection preference migration',error)}}

  /** @param {CalendarIdentity[]} calendars @param {unknown[]} pending @param {RequestScope} scope */
  async function ensureAccount(calendars,pending,{assertCurrent}){
    assertCurrent();
    const primary=calendars.find(calendar=>calendar.primary)||calendars.find(calendar=>calendar.accessRole==='owner')||calendars[0];
    const accountId=String(primary?.id||'');
    if(!accountId)throw new Error('Google לא החזיר יומן פעיל לחשבון');
    const expected=String(session.expectedAccountId||'');
    if(expected&&expected!==accountId){
      auth.rejectToken(session.accessToken);
      throw Object.assign(new Error('Google חיברה חשבון אחר מהחשבון שנשמר ליומן הזה. החיבור האוטומטי נעצר כדי לא לערבב בין יומנים; לחץ על התחבר ל-Google ובחר את החשבון הרצוי.'),{code:'calendar_account_mismatch'});
    }
    const stored=String(await storage.getMeta('accountId')||''),changed=!!stored&&stored!==accountId;
    assertCurrent();
    if(changed){
      if(pending.length)throw new Error('קיימים שינויים ממתינים מחשבון Google אחר. התחבר לחשבון הקודם כדי לשלוח אותם לפני החלפת חשבון.');
      await storage.clearRangeCache();assertCurrent();display.clearCache();
    }
    await storage.putMeta('accountId',accountId);assertCurrent();
    storage.saveConnectionPreference({autoConnect:true,accountId});
    session.accountId=accountId;session.autoConnect=true;session.expectedAccountId='';session.accountVerified=true;return accountId;
  }

  /** @param {{quiet?:boolean,force?:boolean}} [options] @returns {Promise<boolean>} */
  async function syncNow({quiet=false,force=true}={}){
    const pending=syncFlight.current();if(pending)return pending;
    const range=display.prefetchRange();if(!force&&display.cacheCovers(range))return false;
    /** @type {CalendarDisplayAuthority} */ let authority;
    try{authority=lifetime.capture()}catch(error){if(!quiet)feedback.toast(errorMessage(error));return false}
    const {assertCurrent}=authority,scope={assertCurrent,signal:authority.signal};
    /** @type {CalendarSnapshot|null} */ let syncedSnapshot=null;
    let syncSucceeded=false,continuePending=false;
    return syncFlight.run(authority,async({isCurrent:current})=>{
      try{
        assertCurrent();session.syncing=true;session.lastError='';display.status();
        if(!effects.isOnline())throw new Error('אין חיבור לרשת');
        if(!auth.hasUsableToken())throw auth.authRequiredError();
        const calendars=await api.listCalendars(scope);assertCurrent();
        let pending=await storage.listOperations();assertCurrent();
        const accountId=await ensureAccount(calendars,pending,scope);assertCurrent();
        display.setCalendars(calendars);
        await journal.flushPending(scope);assertCurrent();
        pending=await storage.listOperations();assertCurrent();
        const events=await api.fetchEvents(calendars,range,scope);assertCurrent();
        const snapshot={key:range.key,owner:authority.owner,accountId,rangeStart:range.startKey,rangeEnd:range.endKey,fetchedAt:new Date().toISOString(),calendars,events};
        await storage.putRangeCache(snapshot);assertCurrent();
        // A fresh remote read proves neither queue emptiness nor durable delivery
        // of an edit that arrived during the read/cache awaits.
        const receipt=await storage.readPendingSnapshot();assertCurrent();
        if(!receipt.isCurrent()){continuePending=receipt.isSettled();return false}
        // The earlier receipt can become stale in another realm without changing
        // our generation. The storage port rereads and owns synchronous publication
        // inside its native read transaction; there is no await in this callback.
        /** @type {{receipt?:PendingReceipt}} */ const publication={};
        const confirmedResult=await storage.confirmPendingSnapshot(confirmed=>{
          assertCurrent();
          publication.receipt=confirmed;
          if(!confirmed.isCurrent()){continuePending=confirmed.isSettled();return false}
          pending=confirmed.operations;display.setPending(pending);
          syncedSnapshot=snapshot;syncSucceeded=true;session.lastError='';session.queueObservationError='';
          display.publish(snapshot,pending)
          if(pending.length){continuePending=true;return false}
          session.lastSyncAt=snapshot.fetchedAt;
          if(!quiet)feedback.toast('יומן Google עודכן');return true;
        });
        assertCurrent();
        if(!publication.receipt?.isCurrent()){continuePending=publication.receipt?.isSettled()===true;return false}
        return confirmedResult;
      }catch(error){
        syncSucceeded=false;continuePending=false;
        if(details(error).code==='CALENDAR_OPERATION_SCOPE_CHANGED'||!current())return false;
        session.lastError=details(error).code==='calendar_auth_required'?'נדרשת התחברות ל-Google':errorMessage(error)||'סנכרון היומן נכשל';
        try{const pending=await storage.listOperations();if(!current())return false;display.setPending(pending)}catch(error){if(!current())return false;console.error(error)}
        if(!quiet&&errorMessage(error))feedback.toast(errorMessage(error));if(display.isOpen())display.render();
        if(details(error).status===401&&session.autoConnect&&effects.isOnline())queueMicrotask(()=>{if(current())wake(resumeKnownConnectionSilently)});
        console.error('calendar sync',error);return false;
      }
    },({isCurrent:current,release})=>{
      // A former task cannot clear a newer login's busy flag or promise.
      if(release()){session.syncing=false;if(current()&&display.isOpen())display.status()}
      const changedRange=syncSucceeded&&syncedSnapshot!==null&&display.isOpen()&&!display.containsPrefetch(syncedSnapshot);
      if((continuePending||changedRange)&&current()){
        // Only known new work after a successful delivery/read requests another
        // pass. Failed or uncertain delivery keeps the existing retry policy.
        wake(()=>{if(current()&&auth.hasUsableToken()&&effects.isOnline())return syncNow({quiet:true,force:continuePending})});
      }
    });
  }

  async function restoreKnownConnectionOrAuthorize(){
    const {assertCurrent}=lifetime.capture();
    try{
      await auth.restore();assertCurrent();
      if(auth.hasUsableToken()){const synced=await syncNow({quiet:true});assertCurrent();return synced===true}
    }catch(error){
      if(!['calendar_not_connected','calendar_reconnect_required'].includes(String(details(error).code||'')))throw error;
      assertCurrent();
    }
    await auth.beginConnect({returnUrl:calendarOAuthReturnUrl(),assertCurrent:lifetime.checkpoint()});return false;
  }

  async function calendarAuthAction(){
    const assertDisplay=lifetime.checkpoint();
    try{
      const {assertCurrent}=lifetime.capture();
      const pending=reconnectFlight.current();if(pending){await pending;assertCurrent();if(auth.hasUsableToken())return}
      if(auth.hasUsableToken()){
        await auth.disconnect();assertDisplay();
        storage.saveConnectionPreference({autoConnect:false,accountId:session.accountId});session.autoConnect=false;session.expectedAccountId='';session.lastError='';display.status();
        feedback.toast('החיבור ל-Google נותק. שינויים ממתינים נשארים שמורים מקומית.');return;
      }
      session.expectedAccountId='';session.lastError='';display.status();return await restoreKnownConnectionOrAuthorize();
    }catch(error){
      try{assertDisplay()}catch{return false}
      if(details(error).code==='CALENDAR_OPERATION_SCOPE_CHANGED')return false;
      session.expectedAccountId='';
      if(details(error).code==='calendar_cloud_auth_required'){session.lastError='';display.status();feedback.requestCloudLogin();return}
      session.lastError=errorMessage(error)||'התחברות ל-Google נכשלה';display.status();feedback.toast(session.lastError);
    }
  }

  async function resumeAfterCloudLogin(){session.expectedAccountId='';session.lastError='';display.status();return restoreKnownConnectionOrAuthorize()}

  async function refreshCalendar(){
    if(!auth.hasUsableToken()&&!session.autoConnect)return calendarAuthAction();
    try{
      const {assertCurrent}=lifetime.capture();
      const pending=reconnectFlight.current();if(pending){await pending;assertCurrent();if(auth.hasUsableToken())return syncNow({quiet:false})}
      if(!auth.hasUsableToken()&&session.autoConnect&&effects.isOnline()){await resumeKnownConnectionSilently();assertCurrent();if(auth.hasUsableToken())return syncNow({quiet:false})}
      assertCurrent();if(!auth.hasUsableToken())return calendarAuthAction();return syncNow({quiet:false});
    }catch(error){
      if(details(error).code==='CALENDAR_OPERATION_SCOPE_CHANGED')return false;
      if(details(error).code==='calendar_cloud_auth_required')return calendarAuthAction();
      throw error;
    }
  }

  function beginRememberedReconnect({syncRegardlessOfView=false}={}){
    if((!display.isPrimary()&&!display.isOpen())||!session.autoConnect||auth.hasUsableToken()||!effects.isOnline()||!auth.ready())return null;
    const pending=reconnectFlight.current();if(pending)return pending;
    let authority;try{authority=lifetime.capture()}catch(error){if(details(error).code==='calendar_cloud_auth_required')return null;throw error}
    const {assertCurrent}=authority;
    const promise=reconnectFlight.run(authority,({isCurrent:current,release})=>auth.restore().then(()=>{
      assertCurrent();effects.reconnect.cancel();session.lastError='';
      if(effects.isOnline()&&((syncRegardlessOfView&&display.isPrimary())||display.isOpen()))return syncNow({quiet:true});
    }).catch(error=>{
      if(details(error).code==='CALENDAR_OPERATION_SCOPE_CHANGED'||!current())return;
      session.expectedAccountId='';
      if(['calendar_not_connected','calendar_reconnect_required'].includes(String(details(error).code||''))){storage.saveConnectionPreference({autoConnect:false,accountId:session.accountId});session.autoConnect=false;if(details(error).code==='calendar_reconnect_required')session.lastError=errorMessage(error);return}
      if(details(error).code==='calendar_cloud_auth_required'){if(display.isOpen())session.lastError=errorMessage(error);return}
      if(details(error).code==='calendar_data_api_unavailable'&&display.isPrimary()){effects.reconnect.schedule(()=>{if(current())wake(resumeKnownConnectionSilently)},Math.max(1000,Number(details(error).retryAfterMs||15_000)))}
      session.lastError=errorMessage(error)||'החיבור האוטומטי ל-Google נכשל';if(display.isOpen())console.error('calendar auto reconnect',error);
    }).finally(()=>{
      if(release()&&current()&&display.isOpen())display.status();
    }));
    if(display.isOpen())display.status();return promise;
  }

  function resumeKnownConnectionSilently(){return beginRememberedReconnect({syncRegardlessOfView:true})}

  function start(){
    if(disposed||started)return false;started=true;

    const assertActive=lifetime.checkpoint();
    wake(async()=>{await hydrateLegacyConnectionPreference();assertActive();if(!auth.configured()||(!display.isPrimary()&&!display.isOpen()))return;await auth.prepare();assertActive();await resumeKnownConnectionSilently()});
    const resume=()=>{if(!display.isPrimary()&&!display.isOpen())return;if(auth.hasUsableToken()){if(display.isOpen())wake(()=>syncNow({quiet:true}));return}wake(resumeKnownConnectionSilently)};
    try{
      effects.start({resume,offline:()=>{if(display.isOpen()){session.lastError='';display.status()}},
        canPoll:()=>display.isOpen()&&!session.syncing,interval:Math.max(30_000,Number(googleCalendarConfig.pollIntervalMs||60_000))});
    }catch(error){dispose();throw error}
    return true;
  }
  function dispose(){if(disposed)return false;disposed=true;effects.dispose();syncFlight.dispose();reconnectFlight.dispose();actions.close();return true}
  async function drain(){do{await Promise.all([actions.drain(),syncFlight.drain(),reconnectFlight.drain(),effects.drain()])}while(isPending())}
  function isPending(){return actions.isPending()||syncFlight.isPending()||reconnectFlight.isPending()}
  /** @template R @param {()=>R} run */
  function command(run){return ()=>disposed?Promise.resolve(false):actions.run(run)}
  /** @param {{quiet?:boolean,force?:boolean}} [options] */
  function syncCommand(options){return disposed?Promise.resolve(false):actions.run(()=>syncNow(options))}
  return {start,dispose,drain,isPending,wake,isReconnecting:()=>!!reconnectFlight.current(),syncNow:syncCommand,refreshCalendar:command(refreshCalendar),calendarAuthAction:command(calendarAuthAction),resumeAfterCloudLogin:command(resumeAfterCloudLogin)};
}
