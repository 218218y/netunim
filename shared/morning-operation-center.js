const PATH='/functions/v1/morning-documents';
const REFRESH_INTERVAL=45_000;
const RETRY_DELAYS=[4_000,12_000,30_000,60_000];
const LIST_DEADLINE=12_000;
const STAGES={
  verification:['המסמך ממתין לאימות','בדיקת המצב תברר אם המסמך כבר הופק.'],
  payment_evidence:['חסר אימות תקבולים','רישום הצ׳קים יוכל להמשיך לאחר שמורנינג תחזיר את פירוט התקבולים.'],
  payment_mismatch:['התקבולים אינם תואמים למסמך','נדרשת בדיקה של פירוט התקבולים במורנינג.'],
  check_registration:['רישום צ׳קים בקופה ממתין','בדיקת המצב יכולה לחדש את רישום הצ׳קים המאומתים.'],
  bank_link:['קישור מסמך לתנועת בנק ממתין','בדיקת המצב יכולה להשלים את הקישור.'],
  debt_update:['עדכון החוב ממתין לשמירה בענן','אפשר להמשיך מהחוב באתר ההזמנות.'],
  registered:['רישום הצ׳קים הושלם',''],
};
const TYPES={305:'חשבונית מס',320:'חשבונית מס / קבלה',400:'קבלה'};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sameAccount=(a,b)=>a?.owner===b?.owner&&a?.epoch===b?.epoch;
const dateFormat=new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'});
const moneyFormat=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'});
const FILTERS={active:'כל הפעולות הממתינות',attention:'דורשות טיפול',waiting:'ממתינות להתאוששות',verification:'ממתינות לאימות',resolved:'הושלמו לאחרונה'};
const JOBS={bank:'התאמת צ׳קים לתנועות בנק',morning:'רישום צ׳קים ממורנינג'};
const JOB_STATES={healthy:'משימת הרקע פעילה',checking:'ממתין לאימות ריצה ראשונה',
  retrying:'הבדיקה תתחדש אוטומטית',delayed:'העבודה ממתינה מעבר לזמן הצפוי',
  stopped:'ההתאוששות האוטומטית נעצרה',job_unavailable:'לא התקבל אישור שמשימת הרקע פועלת'};
const JOB_FAILURES={authorization:'נדרשת בדיקת הרשאות',invalid_data:'נדרשת בדיקת הנתונים',
  transient:'חיבור או כתיבה התעכבו',unexpected:'נדרשת בדיקה של השגיאה שנרשמה'};
const jobNeedsAttention=job=>['delayed','stopped','job_unavailable'].includes(job.state);
const CLOUD_STATUS={idle:'טרם אומת מצב פעולות מורנינג.',stale:'מצב פעולות מורנינג אינו מעודכן כרגע.',
  unavailable:'לא ניתן לאמת את מצב פעולות מורנינג בענן.',auth:'יש להתחבר מחדש או להשלים אימות לצפייה בפעולות מורנינג.',
  offline:'אין חיבור לענן. מוצג מצב פעולות מורנינג האחרון שהתקבל.'};
const RESULT_MESSAGES={created:'ההתאוששות הושלמה.',already_registered:'הצ׳קים כבר נרשמו. מצב יתר השלבים מופיע ברשימה.',
  registered:'רישום הצ׳קים הושלם.',busy:'מתבצע ניסיון התאוששות במקביל. אפשר לבדוק את המצב שוב לאחר סיומו.',
  failed:'ניסיון ההתאוששות נכשל. פרטי הכשל והשלב הבא מופיעים בפרטי הפעולה.',
  verification:'אימות המסמך או התקבולים עדיין ממתין.',bank_link:'קישור המסמך לתנועת הבנק עדיין ממתין.',
  'decision-required':'נדרשת הכרעה לגבי זקיפת החוב. יש לפתוח את החוב להמשך טיפול.',
  'local-pending':'עדכון החוב עדיין ממתין לאישור כתיבה עמידה.',
  'debt-sync-pending':'עדכון החוב נשמר בעמדה וממתין לאישור כתיבה בענן.',
  'other-local-recovery':'עמדה זו מחזיקה פעולת התאוששות אחרת. יש להשלים אותה תחילה.',
  'write-blocked':'יש להשלים את הטיפול בעמדה הראשית של אתר ההזמנות.',
  'missing-debt':'החוב המקורי חסר בענן. יש לאתר ולשחזר את החוב לפני ניסיון נוסף.',
  'conflicting-recovery':'קישור המסמך או תנועות החוב דורשים בדיקה. מומלץ לצרף את פרטי האבחון לפנייה למנהל המערכת.',
  'verification-mismatch':'פרטי המסמך והחוב אינם תואמים. יש לבדוק אותם בעזרת פרטי האבחון.',
  'decision-changed':'ההכרעה השתנתה בעמדה אחרת. רענן את מצב הפעולה לפני אישור נוסף.',
  debt_update:'עדכון החוב עדיין ממתין באתר ההזמנות.',
  'cleanup-pending':'נקודת ההתאוששות עדיין ממתינה לניקוי בטוח.',
  'scope-changed':'הרשאת ההתאוששות השתנתה. יש לבדוק מחדש מהחשבון הפעיל.',
  unavailable:'מצב הפעולה אינו זמין כרגע. אפשר לבדוק שוב לאחר שהחיבור חוזר.',auth:CLOUD_STATUS.auth};
const dateLabel=value=>value!=null&&Number.isFinite(new Date(value).getTime())?dateFormat.format(new Date(value)):'';

function retryAfter(response,now){
  if(response.status!==429&&response.status!==503)return 0;
  const value=response.headers?.get?.('Retry-After');
  if(!value)return 0;
  const seconds=Number(value);
  return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,(Date.parse(value)||0)-now);
}

function decodeOperations(value){
  if(!Array.isArray(value)||value.length>71)throw new Error('morning_recovery_list_invalid');
  const ids=new Set();
  return value.map(row=>{
    if(!row||typeof row.operation_id!=='string'||!UUID.test(row.operation_id)||ids.has(row.operation_id)
      ||!Object.hasOwn(STAGES,row.stage)||!Object.hasOwn(TYPES,row.document_type)
      ||(row.resolved_at!==null)!==(row.stage==='registered')
      ||!Number.isFinite(Number(row.amount))||!Number.isFinite(Number(row.check_amount))
      ||!Number.isInteger(row.check_count)||row.check_count<0||row.check_count>12
      ||!Number.isInteger(row.attempts)||row.attempts<0)throw new Error('morning_recovery_item_invalid');
    ids.add(row.operation_id);
    return row;
  });
}

function decodeBackground(value){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object')return null;
  const jobs=Object.entries(JOBS).map(([kind,label])=>{
    const row=value[kind];
    if(!row||!Object.hasOwn(JOB_STATES,row.state)||!Number.isSafeInteger(row.pending)||row.pending<0)return null;
    return {kind,label,state:row.state,pending:row.pending,lastRun:dateLabel(row.last_run_at),progress:dateLabel(row.progressed_at),
      oldest:dateLabel(row.oldest_at),retry:dateLabel(row.next_retry_at),firstFailure:dateLabel(row.first_failed_at),
      lastFailure:dateLabel(row.last_failed_at),attempts:Number.isSafeInteger(row.attempts)&&row.attempts>0?row.attempts:0,
      failure:Object.hasOwn(JOB_FAILURES,row.failure_kind)?JOB_FAILURES[row.failure_kind]:''};
  });
  return jobs.every(Boolean)?jobs:null;
}

function severity(row){
  if(row.stage==='registered')return 'הושלם';
  if(row.stage==='verification'||row.stage==='payment_mismatch')return 'דורש בדיקה';
  if(row.stage==='debt_update')return 'דורש טיפול';
  if(row.stage==='check_registration'&&row.error_code&&!row.next_retry_at)return 'דורש טיפול';
  return 'ממתין';
}

function receiptMessage(result){
  if(result.state==='cooldown')return `הניסיון מוגבל עד ${dateLabel(result.retry_at)||'תום ההמתנה'}.`;
  return RESULT_MESSAGES[result.state]||RESULT_MESSAGES.verification;
}

function serverOutcome(status){
  if(status.check_retry&&['busy','cooldown','failed'].includes(status.check_retry.state))return status.check_retry;
  if(status.unresolved||status.retryable_reserved||status.checks_registration_pending)return {state:'verification'};
  if(status.bank_link_pending)return {state:'bank_link'};
  if(status.debt_recovery_pending)return {state:'debt_update'};
  if(status.available===false)return {state:'unavailable'};
  return status.check_retry||{state:status.operation?.state||'unavailable'};
}

export function createMorningOperationCenter({request,accountScope,publish,recoverLocal,debtAction,ordersRecoveryUrl='',
  now=Date.now,isOnline=()=>globalThis.navigator?.onLine!==false,isVisible=()=>globalThis.document?.visibilityState!=='hidden',timers=globalThis}){
  let observed=null,operations=[],background,availability='idle',lastSuccess=null,nextRead=0,flight=null,closed=false;
  let filter='active',query='',page={rows:[],next:null},activeNext=null,pageStack=[null],viewSequence=0,viewRead=null,viewLoading=false,viewError=false;
  let polling=false,timer=null,failures=0,serverRetryAt=0;
  const acknowledged=new Set(),recovering=new Map(),results=new Map();
  function clearTimer(){if(timer!==null)timers.clearTimeout(timer);timer=null}
  function cancelReads(){
    const current=flight;flight=null;current?.controller.abort();
    viewRead?.abort();viewRead=null;
  }
  function syncScope(){
    const scope=accountScope();
    if(!sameAccount(scope,observed)){
      clearTimer();cancelReads();failures=0;serverRetryAt=0;
      observed=scope;operations=[];background=undefined;availability=scope.owner?'idle':'signed_out';lastSuccess=null;nextRead=0;
      filter='active';query='';page={rows:[],next:null};activeNext=null;pageStack=[null];viewSequence++;viewLoading=false;viewError=false;
      acknowledged.clear();recovering.clear();results.clear();publish();
    }
    return scope;
  }
  function assertScope(scope){if(closed||!scope.owner||!sameAccount(accountScope(),scope))throw new Error('morning_recovery_account_changed')}
  async function call(action,body,scope,priority='low',signal){
    const assertRequestScope=()=>{assertScope(scope);signal?.throwIfAborted()};
    assertRequestScope();
    const response=await request(PATH,{method:'POST',body:JSON.stringify({action,...body}),dataPriority:priority,networkRetry:false,assertRequestScope,...(signal?{signal}:{})});
    assertRequestScope();
    if(response.status===401)throw Object.assign(new Error('morning_cloud_auth_required'),{code:'morning_cloud_auth_required'});
    if(!response.ok)throw Object.assign(new Error('morning_recovery_request_failed'),{retryAfterMs:retryAfter(response,now())});
    const value=await response.json();assertRequestScope();
    if(value?.ok!==true)throw new Error('morning_recovery_request_failed');
    return value;
  }
  async function readPage(scope,filter,query,after,controller){
    const signal=controller.signal;signal.throwIfAborted();
    if(now()<serverRetryAt)throw new Error('morning_recovery_rate_limited');
    let cancelled;
    const cancellation=new Promise((_,reject)=>{
      cancelled=()=>reject(signal.reason);
      signal.addEventListener('abort',cancelled,{once:true});
    });
    const deadline=timers.setTimeout(()=>controller.abort(new DOMException('morning_recovery_list_timeout','TimeoutError')),LIST_DEADLINE);
    const ops={page:true,debt_recovery:true,filter,query,after};
    let reply;
    try{
      const body=filter==='active'&&!query&&!after?{...ops,background_health:true}:ops;
      reply=await Promise.race([call('list_recovery',body,scope,'low',signal),cancellation]);
    }catch(error){
      if(!closed&&sameAccount(accountScope(),scope)&&error?.retryAfterMs>0){
        serverRetryAt=Math.max(serverRetryAt,now()+error.retryAfterMs);
        nextRead=Math.max(nextRead,serverRetryAt);schedule();
      }
      throw error;
    }finally{timers.clearTimeout(deadline);signal.removeEventListener('abort',cancelled)}
    const rows=decodeOperations(reply.operations),next=reply.next??null;
    if(next!==null&&(![0,1,2].includes(next.priority)||!dateLabel(next.sort_at)||next.operation_id!==rows.at(-1)?.operation_id))throw new Error('morning_recovery_page_invalid');
    return {rows,next,background:decodeBackground(reply.background_health)};
  }
  const onFirstActivePage=()=>filter==='active'&&query===''&&pageStack.length===1;
  function schedule(){
    clearTimer();
    if(!polling||closed||flight||!observed?.owner||!isVisible()||!isOnline())return;
    const wait=Math.min(2_147_000_000,Math.max(0,nextRead-now()));
    timer=timers.setTimeout(()=>{timer=null;void wake()},wait);
  }
  function wake(){
    syncScope();
    if(!isVisible()){clearTimer();return Promise.resolve(false)}
    return refresh();
  }
  function refresh({force=false}={}){
    const scope=syncScope();
    if(closed||!scope.owner)return Promise.resolve(false);
    if(!isOnline()){
      clearTimer();cancelReads();
      if(availability!=='offline'){availability='offline';publish()}
      return Promise.resolve(false);
    }
    if(flight&&sameAccount(scope,flight.scope))return flight.promise;
    if(now()<serverRetryAt||(!force&&availability!=='offline'&&now()<nextRead)){schedule();return Promise.resolve(false)}
    clearTimer();
    const job={scope,controller:new AbortController(),promise:null};
    flight=job;
    job.promise=Promise.resolve().then(async()=>{
      try{
        const current=await readPage(scope,'active','',null,job.controller);assertScope(scope);
        if(flight!==job)return false;
        if(!isOnline())throw new Error('morning_recovery_offline');
        operations=current.rows;activeNext=current.next;background=current.background;availability='fresh';lastSuccess=now();
        failures=0;nextRead=Math.max(serverRetryAt,lastSuccess+REFRESH_INTERVAL);
        if(!activeNext&&operations.length<=50){
          const keys=new Set(operations.filter(row=>!row.resolved_at).map(ackKey));
          for(const key of acknowledged)if(!keys.has(key))acknowledged.delete(key);
        }
        return true;
      }catch(error){
        if(closed||flight!==job||!sameAccount(accountScope(),scope))return false;
        const auth=['cloud_auth_required','morning_cloud_auth_required'].includes(error?.code);
        availability=auth?'auth':!isOnline()?'offline':lastSuccess!==null?'stale':'unavailable';
        const delay=RETRY_DELAYS[failures];
        failures=Math.min(failures+1,RETRY_DELAYS.length-1);
        const currentTime=now();
        nextRead=Math.max(serverRetryAt,currentTime+(auth?REFRESH_INTERVAL:delay));
        return false;
      }finally{
        if(flight===job){flight=null;schedule();publish()}
      }
    });
    return job.promise;
  }
  const active=()=>operations.filter(row=>!row.resolved_at);
  const ackKey=row=>`${row.operation_id}:${row.stage}:${severity(row)}:${row.failure_kind||''}`;
  const shown=()=>onFirstActivePage()?operations:page.rows;
  const nextPage=()=>onFirstActivePage()?activeNext:page.next;
  const urgent=()=>active().find(row=>severity(row)==='דורש טיפול'&&!acknowledged.has(ackKey(row)));

  async function view(nextFilter,nextQuery,stack){
    const scope=syncScope(),sequence=++viewSequence;
    const firstActive=nextFilter==='active'&&nextQuery===''&&stack.length===1;
    assertScope(scope);viewRead?.abort();
    const controller=firstActive?null:new AbortController();viewRead=controller;
    viewLoading=true;viewError=false;publish();
    try{
      const response=controller?await readPage(scope,nextFilter,nextQuery,stack.at(-1),controller):null;
      if(firstActive&&!await refresh({force:true}))throw new Error('morning_recovery_refresh_unconfirmed');
      assertScope(scope);
      if(sequence!==viewSequence)return;
      filter=nextFilter;query=nextQuery;pageStack=stack;if(response)page=response;
    }catch{
      if(sequence===viewSequence)viewError=true;
    }finally{if(sequence===viewSequence){viewRead=null;viewLoading=false;publish()}}
  }
  const search=(mode,term)=>view(Object.hasOwn(FILTERS,mode)?mode:'active',String(term||'').trim().slice(0,80),[null]);

  async function action(name,id){
    const scope=syncScope(),row=shown().find(item=>item.operation_id===id)||operations.find(item=>item.operation_id===id);
    assertScope(scope);
    if(name==='morning-next'){const next=nextPage();if(next)await view(filter,query,[...pageStack,next]);return}
    if(name==='morning-previous'){if(pageStack.length>1)await view(filter,query,pageStack.slice(0,-1));return}
    if(!row)return;
    if(name==='morning-ack'){acknowledged.add(ackKey(row));publish();return}
    if(name==='morning-copy'){
      const report={operationId:id,documentType:row.document_type,source:row.source_kind,stage:row.stage,documentNumber:row.document_number,errorCode:row.error_code,
        failureKind:row.failure_kind,attempts:row.attempts,firstFailedAt:row.first_failed_at,
        lastAttemptAt:row.last_attempt_at,lastFailureAt:row.failure_kind?row.last_attempt_at:null,nextRetryAt:row.next_retry_at,
        documentVerified:!!row.verified_at,paymentEvidence:row.payment_evidence,checksRegisteredAt:row.checks_registered_at,
        bankLinked:row.bank_linked,debtState:row.debt_state,requiresUserAction:severity(row)!=='ממתין'&&!row.resolved_at};
      await navigator.clipboard.writeText(JSON.stringify(report,null,2));return;
    }
    if(name==='morning-debt'){await debtAction?.(row)?.();return}
    if(name==='morning-document'){
      if(!row.verified_at||!UUID.test(row.document_id||''))return;
      const tab=globalThis.open('about:blank','_blank');
      if(!tab)throw new Error('morning_document_popup_blocked');
      tab.opener=null;
      try{
        const reply=await call('document_links',{document_id:row.document_id},scope,'high');
        const url=new URL(reply.url);
        if(url.protocol!=='https:')throw new Error('morning_document_link_invalid');
        tab.location.replace(url.href);
      }catch(error){tab.close();throw error}
      return;
    }
    if(name!=='morning-retry'||row.resolved_at||recovering.has(id))return;
    const token={};recovering.set(id,token);publish();
    try{
      const local=await recoverLocal?.(id,row);assertScope(scope);
      let outcome=local;
      if(!local){
        const result=await call('status',{operation_id:id,reconcile:true,retry_checks:true},scope,'high');
        if(result.operation?.operation_id!==id)throw new Error('morning_recovery_receipt_mismatch');
        outcome=serverOutcome(result);
      }
      results.set(id,receiptMessage(outcome));
      // If a list was already in flight, its snapshot may predate this attempt.
      await flight?.promise;assertScope(scope);await refresh({force:true});
      if(!onFirstActivePage())await view(filter,query,pageStack);
    }catch(error){
      if(sameAccount(accountScope(),scope)&&!closed)results.set(id,receiptMessage({state:error?.code==='morning_cloud_auth_required'?'auth':'unavailable'}));
    }finally{if(recovering.get(id)===token){recovering.delete(id);publish()}}
  }

  function markup(escape){
    const jobCard=job=>{
      const inputs=[['ריצה אחרונה',job.lastRun],['התקדמות אחרונה',job.progress],['הפעולה הוותיקה בתור',job.oldest],
        ['כשל ראשון',job.firstFailure],['כשל אחרון',job.lastFailure],['ניסיון אוטומטי הבא',job.retry],['ניסיונות שנכשלו',job.attempts]];
      return `<li><details data-incident-details="financial-job-${job.kind}" ${jobNeedsAttention(job)?'data-job-warning':''}>
        <summary>${job.label} · ${JOB_STATES[job.state]}</summary>
        <p>${job.pending?`${job.pending} ממתינות בתור לחשבון זה`:'אין עבודות ממתינות בחשבון זה'}${job.failure?' · '+job.failure:''}</p>
        <dl>${inputs.filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        </details></li>`;
    };
    const button=(name,caption,id,disabled=false)=>`<button type="button" data-incident-action="morning-${name}" data-incident-id="${escape(id)}" ${disabled?'disabled':''}>${caption}</button>`;
    const card=row=>{
      const id=row.operation_id,busy=recovering.has(id),stage=STAGES[row.stage];
      const registered=!!row.checks_registered_at||row.stage==='bank_link'||row.stage==='registered';
      const fields=[['תאריך פעולה',dateLabel(row.verified_at||row.created_at)],['סכום המסמך',moneyFormat.format(Number(row.amount))],
        ['אימות המסמך',row.verified_at?'הושלם':'ממתין'],
        ['אימות התקבולים',row.check_count?(row.payment_evidence==='matched'||registered?'הושלם':row.stage==='payment_mismatch'?'אי התאמה':'ממתין'):''],
        ['רישום צ׳קים בקופה',row.check_count?(registered?`${row.check_count} נרשמו`:`${row.check_count} ממתינים · ${moneyFormat.format(Number(row.check_amount))}`):''],
        ['קישור לבנק',row.source_kind==='bank'?(row.bank_linked?'הושלם':'ממתין'):''],
        ['עדכון החוב',row.debt_state==='pending'?'ממתין לשמירה בענן':row.debt_state==='preserved'?'נשמר בענן':''],
        ['כשל ראשון',dateLabel(row.first_failed_at)],['ניסיון אחרון',dateLabel(row.last_attempt_at)],['ניסיון אוטומטי הבא',dateLabel(row.next_retry_at)],
        ['ניסיונות שנכשלו או דרשו אימות',row.attempts||''],['הושלם',dateLabel(row.resolved_at)]];
      const title=row.stage==='registered'&&!row.check_count?(row.debt_state==='preserved'?'עדכון החוב נשמר בענן':'קישור המסמך לבנק הושלם'):stage[0];
      return `<li><strong>${title}</strong><span class="morning-operation-state">${busy?'מתבצעת בדיקה':severity(row)}</span>
        <p>${TYPES[row.document_type]} ${escape(row.document_number||'')}</p>
        <dl>${fields.filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        ${stage[1]?`<p>${stage[1]} ${registered?'':'יש להימנע מהפקה נוספת או מהזנה חוזרת של הצ׳קים.'}</p>`:''}
        ${results.has(id)?`<p role="status">${escape(results.get(id))}</p>`:''}
        <div class="sync-incidents-actions">
          ${row.resolved_at||row.stage==='debt_update'&&!recoverLocal?'':button('retry',row.stage==='debt_update'?'השלם עדכון חוב':'בדוק מצב הפקה',id,busy)}
          ${row.debt_state==='pending'&&!debtAction&&ordersRecoveryUrl?`<a href="${escape(ordersRecoveryUrl)}" target="_blank" rel="noopener">פתח את מרכז הבקרה בהזמנות</a>`:''}
          ${row.verified_at&&UUID.test(row.document_id||'')?button('document','פתח מסמך',id):''}
          ${debtAction?.(row)?button('debt','פתח חוב',id):''}
          ${row.resolved_at||acknowledged.has(ackKey(row))?'':button('ack','קראתי',id)}
        </div>
        <details data-incident-details="${escape(id)}"><summary>פרטי אבחון</summary><p dir="ltr">${escape(id)}${row.error_code?' · '+escape(row.error_code):''}</p>${button('copy','העתק אבחון',id)}</details>
      </li>`;
    };
    const rows=shown(),legacyHistory=onFirstActivePage()?rows.filter(row=>row.resolved_at):[];
    const visible=onFirstActivePage()?rows.filter(row=>!row.resolved_at).slice(0,50):rows;
    return `<section class="morning-operation-center" aria-label="פעולות ממתינות ותקלות מערכת">
      <h3>פעולות ממתינות ותקלות מערכת</h3>
      ${!observed?.owner?'<p>יש להתחבר לענן לצפייה בפעולות.</p>':CLOUD_STATUS[availability]?`<p role="status">${CLOUD_STATUS[availability]}</p>`:''}
      ${lastSuccess!==null?`<p>אימות ענן אחרון ${dateLabel(lastSuccess)}${availability!=='fresh'&&nextRead?' · בדיקה חוזרת אחרי '+dateLabel(nextRead):''}</p>`:''}
      ${background===null?'<p role="status">לא ניתן לאמת את תהליכי הרקע הפיננסיים.</p>':background?`<h4>תהליכי רקע פיננסיים</h4><ul>${background.map(jobCard).join('')}</ul>`:''}
      ${observed?.owner?`<form data-morning-search><label>סינון <select name="filter">${Object.entries(FILTERS).map(([value,label])=>`<option value="${value}" ${filter===value?'selected':''}>${label}</option>`).join('')}</select></label>
        <label>מספר מסמך או מזהה פעולה <input name="query" maxlength="80" value="${escape(query)}"></label><button ${viewLoading?'disabled':''}>חפש</button></form>`:''}
      ${viewError?'<p role="status">לא ניתן לטעון את העמוד המבוקש. הרשימה הקודמת נשמרה.</p>':''}
      ${visible.length?`<ul>${visible.map(card).join('')}</ul>`:availability==='fresh'?'<p>אין פעולות להצגה.</p>':''}
      ${nextPage()||pageStack.length>1?`<div class="sync-incidents-actions">${button('previous','הקודם','',viewLoading||pageStack.length===1)}<span>עמוד ${pageStack.length}</span>${button('next','הבא','',viewLoading||!nextPage())}</div>`:''}
      ${legacyHistory.length?`<details data-incident-details="legacy-history"><summary>רישומי צ׳קים שהושלמו לאחרונה</summary><ul>${legacyHistory.map(card).join('')}</ul></details>`:''}
      ${[...results].filter(([id])=>!rows.some(row=>row.operation_id===id)).slice(-1).map(([,message])=>`<p role="status">${escape(message)}</p>`).join('')}
    </section>`;
  }
  return {start(){polling=true;return wake()},wake,refresh,action,search,markup,
    dispose(){closed=true;clearTimer();cancelReads();viewSequence++},get availability(){return availability},
    get cloudStatusLabel(){
      if(!observed?.owner)return '';
      if(availability==='auth'||availability==='offline'||failures>=2)return CLOUD_STATUS[availability]||'';
      return background===null?'לא ניתן לאמת את תהליכי הרקע הפיננסיים.':background?.some(jobNeedsAttention)?'תהליך רקע פיננסי דורש בדיקה.':'';
    },
    get count(){return active().length},get more(){return !!activeNext||active().length>50},get urgent(){return urgent()},
    get unread(){return active().filter(row=>!acknowledged.has(ackKey(row))).length}};
}
