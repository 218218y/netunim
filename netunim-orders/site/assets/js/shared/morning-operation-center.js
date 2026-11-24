const PATH='/functions/v1/morning-documents';
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
  debt_update:'עדכון החוב עדיין ממתין באתר ההזמנות.',
  'cleanup-pending':'נקודת ההתאוששות עדיין ממתינה לניקוי בטוח.',
  'scope-changed':'הרשאת ההתאוששות השתנתה. יש לבדוק מחדש מהחשבון הפעיל.',
  unavailable:'מצב הפעולה אינו זמין כרגע. אפשר לבדוק שוב לאחר שהחיבור חוזר.',auth:CLOUD_STATUS.auth};
const dateLabel=value=>value!=null&&Number.isFinite(new Date(value).getTime())?dateFormat.format(new Date(value)):'';

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

export function createMorningOperationCenter({request,accountScope,publish,recoverLocal,debtAction,ordersRecoveryUrl='',now=Date.now,isOnline=()=>globalThis.navigator?.onLine!==false}){
  let observed=null,operations=[],background,availability='idle',lastSuccess=null,nextRead=0,flight=null,closed=false;
  let filter='active',query='',page={rows:[],next:null},activeNext=null,pageStack=[null],viewSequence=0,activeSequence=0,viewLoading=false,viewError=false;
  const acknowledged=new Set(),recovering=new Map(),results=new Map();
  function syncScope(){
    const scope=accountScope();
    if(!sameAccount(scope,observed)){
      observed=scope;operations=[];background=undefined;availability=scope.owner?'idle':'signed_out';lastSuccess=null;nextRead=0;
      filter='active';query='';page={rows:[],next:null};activeNext=null;pageStack=[null];viewSequence++;viewLoading=false;viewError=false;
      acknowledged.clear();recovering.clear();results.clear();publish();
    }
    return scope;
  }
  function assertScope(scope){if(closed||!scope.owner||!sameAccount(accountScope(),scope))throw new Error('morning_recovery_account_changed')}
  async function call(action,body,scope,priority='low'){
    const assertRequestScope=()=>assertScope(scope);
    assertRequestScope();
    const response=await request(PATH,{method:'POST',body:JSON.stringify({action,...body}),dataPriority:priority,networkRetry:false,assertRequestScope});
    assertRequestScope();
    if(response.status===401)throw Object.assign(new Error('morning_cloud_auth_required'),{code:'morning_cloud_auth_required'});
    const value=await response.json();assertRequestScope();
    if(!response.ok||value?.ok!==true)throw new Error('morning_recovery_request_failed');
    return value;
  }
  async function readPage(scope,filter,query,after){
    const ops={page:true,debt_recovery:true,filter,query,after};
    const reply=await call('list_recovery',filter==='active'&&!query&&!after?{...ops,background_health:true}:ops,scope);
    const rows=decodeOperations(reply.operations),next=reply.next??null;
    if(next!==null&&(![0,1,2].includes(next.priority)||!dateLabel(next.sort_at)||next.operation_id!==rows.at(-1)?.operation_id))throw new Error('morning_recovery_page_invalid');
    return {rows,next,background:decodeBackground(reply.background_health)};
  }
  const onFirstActivePage=()=>filter==='active'&&query===''&&pageStack.length===1;
  function refresh({force=false}={}){
    const scope=syncScope();
    if(closed||!scope.owner)return Promise.resolve();
    if(!isOnline()){
      if(availability!=='offline'){availability='offline';publish()}
      return Promise.resolve();
    }
    if(flight&&sameAccount(scope,flight.scope))return flight.promise;
    if(!force&&now()<nextRead)return Promise.resolve();
    nextRead=now()+45_000;
    const job={scope,promise:null},sequence=++activeSequence;
    flight=job;
    job.promise=(async()=>{
      try{
        const current=await readPage(scope,'active','',null);assertScope(scope);
        if(sequence!==activeSequence)return;
        if(!isOnline())throw new Error('morning_recovery_offline');
        operations=current.rows;activeNext=current.next;background=current.background;availability='fresh';lastSuccess=now();
        if(!activeNext&&operations.length<=50){
          const keys=new Set(operations.filter(row=>!row.resolved_at).map(ackKey));
          for(const key of acknowledged)if(!keys.has(key))acknowledged.delete(key);
        }
      }catch(error){
        if(closed||sequence!==activeSequence||!sameAccount(accountScope(),scope))return;
        availability=error?.code==='morning_cloud_auth_required'?'auth':!isOnline()?'offline':lastSuccess!==null?'stale':'unavailable';
        nextRead=now()+90_000;
      }finally{
        if(flight===job){flight=null;publish()}
      }
    })();
    return job.promise;
  }
  const active=()=>operations.filter(row=>!row.resolved_at);
  const ackKey=row=>`${row.operation_id}:${row.stage}:${severity(row)}:${row.failure_kind||''}`;
  const shown=()=>onFirstActivePage()?operations:page.rows;
  const nextPage=()=>onFirstActivePage()?activeNext:page.next;
  const urgent=()=>active().find(row=>severity(row)==='דורש טיפול'&&!acknowledged.has(ackKey(row)));

  async function view(nextFilter,nextQuery,stack){
    const scope=syncScope(),sequence=++viewSequence;
    const activeRead=nextFilter==='active'&&nextQuery===''&&stack.length===1?++activeSequence:null;
    assertScope(scope);viewLoading=true;viewError=false;publish();
    try{
      const response=await readPage(scope,nextFilter,nextQuery,stack.at(-1));assertScope(scope);
      if(sequence!==viewSequence)return;
      filter=nextFilter;query=nextQuery;pageStack=stack;page=response;
      if(activeRead===activeSequence){operations=page.rows;activeNext=page.next;background=page.background;availability='fresh';lastSuccess=now();nextRead=now()+45_000}
    }catch{
      if(sequence===viewSequence)viewError=true;
    }finally{if(sequence===viewSequence){viewLoading=false;publish()}}
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
  return {refresh,action,search,markup,syncScope,dispose:()=>{closed=true},get availability(){return availability},
    get cloudStatusLabel(){return observed?.owner?CLOUD_STATUS[availability]||(background===null?'לא ניתן לאמת את תהליכי הרקע הפיננסיים.':
      background?.some(jobNeedsAttention)?'תהליך רקע פיננסי דורש בדיקה.':''):''},
    get count(){return active().length},get more(){return !!activeNext||active().length>50},get urgent(){return urgent()},
    get unread(){return active().filter(row=>!acknowledged.has(ackKey(row))).length}};
}
