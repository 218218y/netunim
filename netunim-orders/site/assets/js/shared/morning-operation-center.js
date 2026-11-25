const PATH='/functions/v1/morning-documents';
const REFRESH_INTERVAL=45_000;
const RETRY_DELAYS=[4_000,12_000,30_000,60_000];
const LIST_DEADLINE=12_000;
const VERIFY_ATTENTION_AFTER=10*60_000;
const BANK_LINK_ATTENTION_AFTER=30*60_000;
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
  transient:'חיבור או כתיבה התעכבו',unexpected:'נדרשת בדיקה של השגיאה שנרשמה',contention:'הכתיבה מתעכבת עקב עבודה מקבילה'};
const SOURCE_STATES={no_history:'טרם התקבלו נתוני בנק',unknown:'זמינות נתוני הבנק טרם אומתה',
  missing:'נתוני בנק צפויים חסרים',stale:'נתוני הבנק אינם עדכניים',fresh:'נתוני הבנק עדכניים'};
const BANK_OUTCOMES={no_checks:'אין צ׳קים לבדיקה',no_bank_data:'בדיקת התאמות ממתינה לנתוני בנק',
  unchanged:'תוצאת ההתאמה נשארה בעינה',checked:'בוצעה בדיקת התאמות'};
const RUN_STATES={healthy:'פעילה',checking:'ממתינה לריצה ראשונה',job_unavailable:'הריצה לא אומתה'};
const jobNeedsAttention=job=>['delayed','stopped','job_unavailable'].includes(job.state)||['missing','stale'].includes(job.sourceState);
const CLOUD_STATUS={idle:'טרם אומת מצב פעולות מורנינג.',stale:'מצב פעולות מורנינג אינו מעודכן כרגע.',
  unavailable:'לא ניתן לאמת את מצב פעולות מורנינג בענן.',auth:'יש להתחבר מחדש או להשלים אימות לצפייה בפעולות מורנינג.',
  mfa:'יש להשלים אימות דו־שלבי כדי להמשיך בפעולת מורנינג.',forbidden:'אין הרשאה לפעולה המבוקשת בחשבון הפעיל.',
  rate_limited:'מונה הפעולות ממתין לסיום הגבלת הקצב בענן.',service_unavailable:'שירות מורנינג בענן אינו זמין זמנית.',
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
  unavailable:'מצב הפעולה אינו זמין כרגע. אפשר לבדוק שוב לאחר שהחיבור חוזר.',auth:CLOUD_STATUS.auth,
  mfa:CLOUD_STATUS.mfa,forbidden:CLOUD_STATUS.forbidden,
  rate_limited:'השירות הגביל את קצב הבדיקות. אפשר לנסות שוב לאחר תום ההמתנה.',
  service_unavailable:CLOUD_STATUS.service_unavailable,
  conflict:'הפעולה השתנתה בענן. רענן את מצבה לפני ניסיון נוסף.',
  rejected:'השירות דחה את הפעולה. בדוק את פרטי הפעולה לפני ניסיון נוסף.'};
const RECOVERY_CONFIRMED=new Set(['created','already_registered','registered']);
const dateLabel=value=>value!=null&&Number.isFinite(new Date(value).getTime())?dateFormat.format(new Date(value)):'';

function retryAfter(response,now){
  if(response.status!==429&&response.status!==503)return 0;
  const value=response.headers?.get?.('Retry-After');
  if(!value)return 0;
  const seconds=Number(value);
  return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,(Date.parse(value)||0)-now);
}

function decodeOperations(value,serverSeverity){
  if(!Array.isArray(value)||value.length>71)throw new Error('morning_recovery_list_invalid');
  const ids=new Set();
  return value.map(row=>{
    if(!row||typeof row.operation_id!=='string'||!UUID.test(row.operation_id)||ids.has(row.operation_id)
      ||!Object.hasOwn(STAGES,row.stage)||!Object.hasOwn(TYPES,row.document_type)
      ||(serverSeverity&&(!Object.hasOwn(SEVERITY_ORDER,row.severity)
        ||row.priority!==SEVERITY_ORDER[row.severity]||(row.severity==='complete')!==(row.stage==='registered')))
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
    return {kind,label,state:row.state,pending:row.pending,lastRun:dateLabel(row.last_run_at),
      progress:dateLabel(row.business_progressed_at??(kind==='morning'?row.progressed_at:null)),
      evaluated:kind==='bank'?dateLabel(row.progressed_at):'',
      runState:Object.hasOwn(RUN_STATES,row.run_state)?row.run_state:row.state,
      sourceState:Object.hasOwn(SOURCE_STATES,row.source_state)?row.source_state:null,sourceAt:dateLabel(row.source_at),
      lastOutcome:Object.hasOwn(BANK_OUTCOMES,row.last_outcome)?BANK_OUTCOMES[row.last_outcome]:'',
      missingEvidence:Number.isSafeInteger(row.missing_payment_evidence)&&row.missing_payment_evidence>0?row.missing_payment_evidence:0,
      oldest:dateLabel(row.oldest_at),retry:dateLabel(row.next_retry_at),firstFailure:dateLabel(row.first_failed_at),
      lastFailure:dateLabel(row.last_failed_at),attempts:Number.isSafeInteger(row.attempts)&&row.attempts>0?row.attempts:0,
      failure:Object.hasOwn(JOB_FAILURES,row.failure_kind)?JOB_FAILURES[row.failure_kind]:''};
  });
  return jobs.every(Boolean)?jobs:null;
}

const OPERATION_LABELS={complete:'הושלם',critical:'דורש טיפול',error:'דורש טיפול',warning:'דורש בדיקה',info:'ממתין'};
const SEVERITY_ORDER={critical:0,error:1,warning:2,info:3,complete:4};
function severity(row,now){
  if(Object.hasOwn(SEVERITY_ORDER,row.severity))return row.severity;
  // Compatibility with a tab opening while the previous Edge version is live.
  if(row.stage==='registered')return 'complete';
  if(row.stage==='payment_mismatch')return 'critical';
  if(row.stage==='debt_update'||(row.stage==='check_registration'&&row.error_code&&!row.next_retry_at))return 'error';
  if(['verification','payment_evidence'].includes(row.stage)){
    const since=Date.parse(row.first_failed_at||(row.stage==='payment_evidence'&&row.verified_at)||row.created_at);
    return now-since>=VERIFY_ATTENTION_AFTER?'error':'warning';
  }
  if(row.stage==='bank_link'&&now-Date.parse(row.verified_at||row.created_at)>=BANK_LINK_ATTENTION_AFTER)return 'error';
  return 'info';
}

function receiptMessage(result){
  if(result.state==='cooldown'||result.state==='rate_limited'&&result.retry_at)return `הניסיון מוגבל עד ${dateLabel(result.retry_at)||'תום ההמתנה'}.`;
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
const REQUEST_ERRORS={cloud_auth_required:'auth',morning_cloud_auth_required:'auth',mfa_required:'mfa',
  morning_access_forbidden:'forbidden',morning_recovery_conflict:'conflict',morning_rate_limited:'rate_limited',
  morning_service_unavailable:'service_unavailable',morning_action_rejected:'rejected'};
const errorState=error=>Object.hasOwn(REQUEST_ERRORS,error?.code)?REQUEST_ERRORS[error.code]:'unavailable';

export function createMorningOperationCenter({request,accountScope,publish,recoverLocal,debtAction,ordersRecoveryUrl='',
  now=Date.now,isOnline=()=>globalThis.navigator?.onLine!==false,isVisible=()=>globalThis.document?.visibilityState!=='hidden',
  isViewVisible=()=>true,localBankExpected=()=>false,canReconnect=false,timers=globalThis}){
  let observed=null,operations=[],background,availability='idle',lastSuccess=null,nextRead=0,flight=null,closed=false;
  let filter='active',query='',page={rows:[],next:null},activeNext=null,pageStack=[null],viewSequence=0,viewRead=null,viewLoading=false,viewError='';
  let pageVerifiedAt=null,backgroundVerifiedAt=null;
  let polling=false,timer=null,failures=0,backgroundFailures=0,serverRetryAt=0;
  const acknowledged=new Set(),acknowledgedSignals=new Set(),recovering=new Map(),results=new Map();
  function rememberAcknowledgement(key){
    acknowledged.add(key);
    if(acknowledged.size>200)acknowledged.delete(acknowledged.values().next().value);
  }
  function showResult(id,outcome){
    results.delete(id);results.set(id,{state:outcome.state,message:receiptMessage(outcome)});
    if(results.size>50)results.delete(results.keys().next().value);
  }
  function clearResolvedResults(rows,completeActive=false){
    const known=new Map(rows.map(row=>[row.operation_id,row]));
    for(const [id,value] of results){
      if(!RECOVERY_CONFIRMED.has(value.state)&&(known.get(id)?.resolved_at||completeActive&&!known.has(id)))results.delete(id);
    }
  }
  function clearTimer(){if(timer!==null)timers.clearTimeout(timer);timer=null}
  function cancelReads(){
    const current=flight;flight=null;current?.controller.abort();
    viewRead?.abort();viewRead=null;
  }
  function syncScope(){
    const scope=accountScope();
    if(!sameAccount(scope,observed)){
      clearTimer();cancelReads();failures=0;backgroundFailures=0;serverRetryAt=0;
      observed=scope;operations=[];background=undefined;availability=scope.owner?'idle':'signed_out';lastSuccess=null;nextRead=0;
      filter='active';query='';page={rows:[],next:null};activeNext=null;pageStack=[null];viewSequence++;viewLoading=false;viewError='';
      pageVerifiedAt=null;backgroundVerifiedAt=null;
      acknowledged.clear();acknowledgedSignals.clear();recovering.clear();results.clear();publish();
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
    if(!response.ok){
      let code={403:'morning_access_forbidden',409:'morning_recovery_conflict',429:'morning_rate_limited',503:'morning_service_unavailable'}[response.status]
        ||(response.status>=400&&response.status<500?'morning_action_rejected':'morning_recovery_request_failed');
      if(response.status===403){
        const value=await response.json().catch(()=>null);assertRequestScope();
        if(value?.code==='mfa_required')code='mfa_required';
      }
      throw Object.assign(new Error(code),{code,retryAfterMs:retryAfter(response,now())});
    }
    const value=await response.json();assertRequestScope();
    if(value?.ok===false)throw Object.assign(new Error('morning_action_rejected'),{code:'morning_action_rejected'});
    if(value?.ok!==true)throw new Error('morning_recovery_request_failed');
    return value;
  }
  async function boundedCall(action,body,scope,controller,priority='low'){
    const signal=controller.signal;signal.throwIfAborted();
    let cancelled;
    const cancellation=new Promise((_,reject)=>{
      cancelled=()=>reject(signal.reason);
      signal.addEventListener('abort',cancelled,{once:true});
    });
    const deadline=timers.setTimeout(()=>controller.abort(new DOMException('morning_recovery_timeout','TimeoutError')),LIST_DEADLINE);
    let reply;
    try{
      reply=await Promise.race([call(action,body,scope,priority,signal),cancellation]);
    }catch(error){
      if(action==='list_recovery'&&!closed&&sameAccount(accountScope(),scope)&&error?.retryAfterMs>0){
        serverRetryAt=Math.max(serverRetryAt,now()+error.retryAfterMs);
        nextRead=Math.max(nextRead,serverRetryAt);schedule();
      }
      throw error;
    }finally{timers.clearTimeout(deadline);signal.removeEventListener('abort',cancelled)}
    return reply;
  }
  async function readPage(scope,filter,query,after,controller){
    if(now()<serverRetryAt)throw new Error('morning_recovery_rate_limited');
    const ops={page:true,debt_recovery:true,severity_contract:true,filter,query,after};
    const body=filter==='active'&&!query&&!after?{...ops,background_health:true}:ops;
    const reply=await boundedCall('list_recovery',body,scope,controller);
    const serverSeverity=reply.severity_contract===true;
    const rows=decodeOperations(reply.operations,serverSeverity),next=reply.next??null;
    if(next!==null&&(!Number.isInteger(next.priority)||next.priority<0||next.priority>(serverSeverity?4:2)
      ||(serverSeverity&&next.priority!==rows.at(-1)?.priority)||!dateLabel(next.sort_at)||next.operation_id!==rows.at(-1)?.operation_id))throw new Error('morning_recovery_page_invalid');
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
  async function refreshSelected(scope){
    if(onFirstActivePage()||viewLoading||viewRead||!isViewVisible())return;
    const controller=new AbortController(),sequence=viewSequence;
    viewRead=controller;
    const current=()=>!closed&&viewRead===controller&&sequence===viewSequence&&sameAccount(accountScope(),scope);
    try{
      const incoming=await readPage(scope,filter,query,pageStack.at(-1),controller);
      if(current()){page=incoming;pageVerifiedAt=now();viewError='';clearResolvedResults(incoming.rows)}
    }catch(error){if(current())viewError=errorState(error)}
    finally{if(current())viewRead=null}
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
        operations=current.rows;activeNext=current.next;availability='fresh';lastSuccess=now();
        backgroundFailures=current.background===null?Math.min(2,backgroundFailures+1):0;
        if(current.background){background=current.background;backgroundVerifiedAt=lastSuccess}
        clearResolvedResults(operations,!activeNext&&operations.length<=50);
        failures=0;nextRead=Math.max(serverRetryAt,lastSuccess+REFRESH_INTERVAL);
        if(!activeNext&&operations.length<=50){
          const keys=new Set(operations.filter(row=>!row.resolved_at).map(ackKey));
          for(const key of acknowledged)if(!keys.has(key))acknowledged.delete(key);
        }
        if(!onFirstActivePage()){publish();await refreshSelected(scope)}
        if(flight!==job||!sameAccount(accountScope(),scope))return false;
        return true;
      }catch(error){
        if(closed||flight!==job||!sameAccount(accountScope(),scope))return false;
        const state=errorState(error),requiresAuthentication=['auth','mfa','forbidden'].includes(state);
        availability=!isOnline()?'offline':requiresAuthentication||state==='rate_limited'
          ?state:lastSuccess!==null?'stale':'unavailable';
        const delay=RETRY_DELAYS[failures];
        failures=Math.min(failures+1,RETRY_DELAYS.length-1);
        const currentTime=now();
        nextRead=Math.max(serverRetryAt,currentTime+(requiresAuthentication?REFRESH_INTERVAL:delay));
        return false;
      }finally{
        if(flight===job){flight=null;schedule();publish()}
      }
    });
    return job.promise;
  }
  const active=()=>operations.filter(row=>!row.resolved_at);
  const ackKey=row=>`${row.operation_id}:${row.stage}:${severity(row,now())}:${row.failure_kind||row.error_code||''}`;
  const shown=()=>onFirstActivePage()?operations:page.rows;
  const nextPage=()=>onFirstActivePage()?activeNext:page.next;
  function urgent(){
    return active().filter(row=>SEVERITY_ORDER[severity(row,now())]<=1&&!acknowledged.has(ackKey(row)))
      .sort((a,b)=>SEVERITY_ORDER[severity(a,now())]-SEVERITY_ORDER[severity(b,now())]||Date.parse(a.created_at)-Date.parse(b.created_at))[0];
  }
  function attention(){
    const signals=[];
    if(['auth','mfa','forbidden'].includes(availability)&&(active().length||failures>=2))signals.push({
      key:availability,severity:'critical',message:CLOUD_STATUS[availability],reconnect:availability!=='forbidden'});
    else if(failures>=3&&availability!=='offline')signals.push({key:'cloud',severity:'important',message:CLOUD_STATUS[availability]});
    if(backgroundFailures>=2)signals.push({key:'background',severity:'important',message:'לא ניתן לאמת את תהליכי הרקע הפיננסיים.'});
    for(const job of background||[]){
      if(jobNeedsAttention(job))signals.push({key:`job:${job.kind}:${job.state}:${job.sourceState||''}`,
        severity:job.state==='job_unavailable'||job.state==='stopped'?'critical':'important',
        message:`${job.label} · ${['missing','stale'].includes(job.sourceState)?SOURCE_STATES[job.sourceState]:JOB_STATES[job.state]}`});
    }
    const live=new Set(signals.map(signal=>signal.key));
    for(const key of acknowledgedSignals)if(!live.has(key))acknowledgedSignals.delete(key);
    const row=urgent();
    const operation=row&&{key:'operation:'+ackKey(row),operationId:row.operation_id,
      severity:severity(row,now())==='critical'?'critical':'important',
      message:STAGES[row.stage][0]+(row.document_number?` · מסמך ${row.document_number}`:'')};
    return [operation,...signals].filter(signal=>signal&&!acknowledgedSignals.has(signal.key))
      .sort((a,b)=>Number(b.severity==='critical')-Number(a.severity==='critical'))[0];
  }
  function acknowledge(signal){
    if(signal.operationId){const row=active().find(row=>row.operation_id===signal.operationId);if(row&&signal.key==='operation:'+ackKey(row))rememberAcknowledgement(ackKey(row))}
    else acknowledgedSignals.add(signal.key);
    publish();
  }

  async function view(nextFilter,nextQuery,stack){
    const scope=syncScope(),sequence=++viewSequence;
    const firstActive=nextFilter==='active'&&nextQuery===''&&stack.length===1;
    assertScope(scope);viewRead?.abort();
    const controller=firstActive?null:new AbortController();viewRead=controller;
    viewLoading=true;viewError='';publish();
    try{
      const response=controller?await readPage(scope,nextFilter,nextQuery,stack.at(-1),controller):null;
      if(firstActive&&!await refresh({force:true}))throw new Error('morning_recovery_refresh_unconfirmed');
      assertScope(scope);
      if(sequence!==viewSequence)return;
      filter=nextFilter;query=nextQuery;pageStack=stack;
      if(response){page=response;pageVerifiedAt=now();clearResolvedResults(response.rows)}
    }catch(error){
      if(sequence===viewSequence)viewError=errorState(error);
    }finally{if(sequence===viewSequence){viewRead=null;viewLoading=false;publish()}}
  }
  const search=(mode,term)=>view(Object.hasOwn(FILTERS,mode)?mode:'active',String(term||'').trim().slice(0,80),[null]);

  async function action(name,id){
    const scope=syncScope(),row=shown().find(item=>item.operation_id===id)||operations.find(item=>item.operation_id===id);
    assertScope(scope);
    if(name==='morning-next'){const next=nextPage();if(next)await view(filter,query,[...pageStack,next]);return}
    if(name==='morning-previous'){if(pageStack.length>1)await view(filter,query,pageStack.slice(0,-1));return}
    if(!row)return;
    if(name==='morning-ack'){rememberAcknowledgement(ackKey(row));publish();return}
    if(name==='morning-copy'){
      const report={operationId:id,documentType:row.document_type,source:row.source_kind,stage:row.stage,documentNumber:row.document_number,errorCode:row.error_code,
        failureKind:row.failure_kind,attempts:row.attempts,firstFailedAt:row.first_failed_at,
        lastAttemptAt:row.last_attempt_at,lastFailureAt:row.failure_kind?row.last_attempt_at:null,nextRetryAt:row.next_retry_at,
        documentVerified:!!row.verified_at,paymentEvidence:row.payment_evidence,checksRegisteredAt:row.checks_registered_at,
        bankLinked:row.bank_linked,debtState:row.debt_state,severity:severity(row,now()),requiresUserAction:SEVERITY_ORDER[severity(row,now())]<=1};
      await navigator.clipboard.writeText(JSON.stringify(report,null,2));return;
    }
    if(name==='morning-debt'){await debtAction?.(row)?.();return}
    if(name==='morning-document'){
      if(!row.verified_at||!UUID.test(row.document_id||''))return;
      const tab=globalThis.open('about:blank','_blank');
      if(!tab)throw new Error('morning_document_popup_blocked');
      tab.opener=null;
      try{
        const reply=await boundedCall('document_links',{document_id:row.document_id},scope,new AbortController(),'high');
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
        const result=await boundedCall('status',{operation_id:id,reconcile:true,retry_checks:true},scope,new AbortController(),'high');
        if(result.operation?.operation_id!==id)throw new Error('morning_recovery_receipt_mismatch');
        outcome=serverOutcome(result);
      }
      showResult(id,outcome);
      // If a list was already in flight, its snapshot may predate this attempt.
      await flight?.promise;assertScope(scope);await refresh({force:true});
    }catch(error){
      if(sameAccount(accountScope(),scope)&&!closed)showResult(id,{state:errorState(error),
        ...(error?.retryAfterMs>0?{retry_at:now()+error.retryAfterMs}:{})});
    }finally{if(recovering.get(id)===token){recovering.delete(id);publish()}}
  }

  function markup(escape){
    const jobCard=job=>{
      const sourceLabel=job.kind==='bank'&&job.sourceState==='no_history'&&localBankExpected()
        ?'עדכון אוטומטי מוגדר בעמדה זו. הענן טרם קיבל נתוני בנק.' : SOURCE_STATES[job.sourceState];
      const inputs=[['ריצה אחרונה',job.lastRun],['השלמה עסקית אחרונה',job.progress],['הפעולה הוותיקה בתור',job.oldest],
        ['מצב המשימה',RUN_STATES[job.runState]],['נתוני מקור',sourceLabel],['תמונת בנק אחרונה',job.sourceAt],
        ['בדיקת התאמות אחרונה',job.evaluated],['תוצאת בדיקת ההתאמה',job.lastOutcome],['מסמכים הממתינים לאימות תקבולים',job.missingEvidence],
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
        ['עדכון החוב',row.debt_state==='pending'?'ממתין לשמירה בענן':row.debt_state==='preserved'?'התאוששות נסגרה בענן':''],
        ['כשל ראשון',dateLabel(row.first_failed_at)],['ניסיון אחרון',dateLabel(row.last_attempt_at)],['ניסיון אוטומטי הבא',dateLabel(row.next_retry_at)],
        ['ניסיונות שנכשלו או דרשו אימות',row.attempts||''],['הושלם',dateLabel(row.resolved_at)]];
      const title=row.stage==='registered'&&!row.check_count?(row.debt_state==='preserved'?'התאוששות החוב נסגרה בענן':'קישור המסמך לבנק הושלם'):stage[0];
      return `<li><strong>${title}</strong><span class="morning-operation-state">${busy?'מתבצעת בדיקה':OPERATION_LABELS[severity(row,now())]}</span>
        <p>${TYPES[row.document_type]} ${escape(row.document_number||'')}</p>
        <dl>${fields.filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        ${stage[1]?`<p>${stage[1]} ${registered?'':'יש להימנע מהפקה נוספת או מהזנה חוזרת של הצ׳קים.'}</p>`:''}
        ${results.has(id)?`<p role="status">${escape(results.get(id).message)}</p>`:''}
        <div class="sync-incidents-actions">
          ${canReconnect&&['auth','mfa'].includes(results.get(id)?.state)?button('authenticate','פתח אימות ענן',id):''}
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
      ${canReconnect&&['auth','mfa'].includes(availability)?button('authenticate','פתח אימות ענן',''):''}
      ${lastSuccess!==null?`<p>אימות ענן אחרון ${dateLabel(lastSuccess)}${availability!=='fresh'&&nextRead?' · בדיקה חוזרת אחרי '+dateLabel(nextRead):''}</p>`:''}
      ${backgroundFailures||background&&availability!=='fresh'?'<p role="status">לא ניתן לאמת את תהליכי הרקע הפיננסיים כעת.</p>':''}
      ${background?`<h4>תהליכי רקע פיננסיים</h4><p>אימות תהליכי רקע אחרון ${dateLabel(backgroundVerifiedAt)}</p><ul>${background.map(jobCard).join('')}</ul>`:''}
      ${observed?.owner?`<form data-morning-search><label>סינון <select name="filter">${Object.entries(FILTERS).map(([value,label])=>`<option value="${value}" ${filter===value?'selected':''}>${label}</option>`).join('')}</select></label>
        <label>מספר מסמך או מזהה פעולה <input name="query" maxlength="80" value="${escape(query)}"></label><button ${viewLoading?'disabled':''}>חפש</button></form>`:''}
      ${!onFirstActivePage()&&pageVerifiedAt!==null?`<p>אימות העמוד המוצג ${dateLabel(pageVerifiedAt)}</p>`:''}
      ${viewError||!onFirstActivePage()&&pageVerifiedAt!==null&&availability!=='fresh'?`<p role="status">${RESULT_MESSAGES[viewError]&&viewError!=='unavailable'?RESULT_MESSAGES[viewError]+' ':''}לא ניתן לעדכן את העמוד. מוצגים הנתונים מהבדיקה האחרונה.</p>`:''}
      ${visible.length?`<ul>${visible.map(card).join('')}</ul>`:availability==='fresh'&&!viewError?'<p>אין פעולות להצגה.</p>':''}
      ${nextPage()||pageStack.length>1?`<div class="sync-incidents-actions">${button('previous','הקודם','',viewLoading||pageStack.length===1)}<span>עמוד ${pageStack.length}</span>${button('next','הבא','',viewLoading||!nextPage())}</div>`:''}
      ${legacyHistory.length?`<details data-incident-details="legacy-history"><summary>רישומי צ׳קים שהושלמו לאחרונה</summary><ul>${legacyHistory.map(card).join('')}</ul></details>`:''}
      ${[...results].filter(([id,value])=>RECOVERY_CONFIRMED.has(value.state)&&!rows.some(row=>row.operation_id===id)).slice(-1).map(([,value])=>`<p role="status">${escape(value.message)}</p>`).join('')}
    </section>`;
  }
  return {start(){polling=true;return wake()},wake,refresh,action,search,markup,acknowledge,
    dispose(){closed=true;clearTimer();cancelReads();viewSequence++},get availability(){return availability},
    get cloudStatusLabel(){
      if(!observed?.owner)return '';
      if(['auth','mfa','forbidden','offline'].includes(availability)||failures>=2)return CLOUD_STATUS[availability]||'';
      return backgroundFailures?'לא ניתן לאמת את תהליכי הרקע הפיננסיים.':background?.some(jobNeedsAttention)?'תהליך רקע פיננסי דורש בדיקה.':'';
    },
    get count(){return active().length},get more(){return !!activeNext||active().length>50},get attention(){return attention()},
    get unread(){return active().filter(row=>!acknowledged.has(ackKey(row))).length}};
}
