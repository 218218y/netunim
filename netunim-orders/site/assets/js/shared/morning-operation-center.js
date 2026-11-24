const PATH='/functions/v1/morning-documents';
const STAGES={
  verification:['המסמך ממתין לאימות','בדיקת המצב תברר אם המסמך כבר הופק.'],
  payment_evidence:['חסר אימות תקבולים','רישום הצ׳קים יוכל להמשיך לאחר שמורנינג תחזיר את פירוט התקבולים.'],
  payment_mismatch:['התקבולים אינם תואמים למסמך','נדרשת בדיקה של פירוט התקבולים במורנינג.'],
  check_registration:['רישום צ׳קים בקופה ממתין','בדיקת המצב יכולה לחדש את רישום הצ׳קים המאומתים.'],
  bank_link:['קישור מסמך לתנועת בנק ממתין','בדיקת המצב יכולה להשלים את הקישור.'],
  registered:['רישום הצ׳קים הושלם',''],
};
const TYPES={305:'חשבונית מס',320:'חשבונית מס / קבלה',400:'קבלה'};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sameAccount=(a,b)=>a?.owner===b?.owner&&a?.epoch===b?.epoch;
const dateFormat=new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'});
const moneyFormat=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'});

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

function severity(row){
  if(row.stage==='registered')return 'הושלם';
  if(row.stage==='verification'||row.stage==='payment_mismatch')return 'דורש בדיקה';
  if(row.stage==='check_registration'&&row.error_code&&!row.next_retry_at)return 'דורש טיפול';
  return 'ממתין';
}

export function createMorningOperationCenter({request,accountScope,publish,recoverLocal,debtAction,now=Date.now}){
  let observed=null,operations=[],available=false,nextRead=0,flight=null,closed=false;
  const acknowledged=new Set(),recovering=new Map();
  function syncScope(){
    const scope=accountScope();
    if(!sameAccount(scope,observed)){
      observed=scope;operations=[];available=false;nextRead=0;acknowledged.clear();recovering.clear();publish();
    }
    return scope;
  }
  function assertScope(scope){if(closed||!scope.owner||!sameAccount(accountScope(),scope))throw new Error('morning_recovery_account_changed')}
  async function call(action,body,scope,priority='low'){
    const assertRequestScope=()=>assertScope(scope);
    assertRequestScope();
    const response=await request(PATH,{method:'POST',body:JSON.stringify({action,...body}),dataPriority:priority,networkRetry:false,assertRequestScope});
    assertRequestScope();
    const value=await response.json();assertRequestScope();
    if(!response.ok||value?.ok!==true)throw new Error('morning_recovery_request_failed');
    return value;
  }
  function refresh({force=false}={}){
    const scope=syncScope();
    if(closed||!scope.owner)return Promise.resolve();
    if(flight&&sameAccount(scope,flight.scope))return flight.promise;
    if(!force&&now()<nextRead)return Promise.resolve();
    nextRead=now()+45_000;
    const job={scope,promise:null};
    flight=job;
    job.promise=(async()=>{
      try{
        const reply=await call('list_recovery',{},scope);
        const rows=decodeOperations(reply.operations);assertScope(scope);
        operations=rows;available=true;
        const keys=new Set(rows.filter(row=>!row.resolved_at).map(ackKey));
        for(const key of acknowledged)if(!keys.has(key))acknowledged.delete(key);
      }catch{
        if(closed||!sameAccount(accountScope(),scope))return;
        available=false;nextRead=now()+90_000;
      }finally{
        if(flight===job){flight=null;publish()}
      }
    })();
    return job.promise;
  }
  const active=()=>operations.filter(row=>!row.resolved_at);
  const ackKey=row=>`${row.operation_id}:${row.stage}:${severity(row)}`;

  async function action(name,id){
    const scope=syncScope(),row=operations.find(item=>item.operation_id===id);
    assertScope(scope);
    if(!row)return;
    if(name==='morning-ack'){acknowledged.add(ackKey(row));publish();return}
    if(name==='morning-copy'){
      const report={operationId:id,stage:row.stage,documentNumber:row.document_number,errorCode:row.error_code,
        failureKind:row.failure_kind,attempts:row.attempts,firstFailedAt:row.first_failed_at,
        lastAttemptAt:row.last_attempt_at,nextRetryAt:row.next_retry_at};
      await navigator.clipboard.writeText(JSON.stringify(report,null,2));return;
    }
    if(name==='morning-debt'){debtAction?.(row)?.();return}
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
      const handled=await recoverLocal?.(id);assertScope(scope);
      if(!handled){
        const result=await call('status',{operation_id:id,reconcile:true,retry_checks:true},scope,'high');
        if(result.operation?.operation_id!==id)throw new Error('morning_recovery_receipt_mismatch');
      }
      // If a list was already in flight, its snapshot may predate this attempt.
      await flight?.promise;assertScope(scope);await refresh({force:true});
    }finally{if(recovering.get(id)===token){recovering.delete(id);publish()}}
  }

  function markup(escape){
    const date=value=>Number.isFinite(Date.parse(value))?dateFormat.format(new Date(value)):'';
    const button=(name,caption,id,disabled=false)=>`<button type="button" data-incident-action="morning-${name}" data-incident-id="${escape(id)}" ${disabled?'disabled':''}>${caption}</button>`;
    const card=row=>{
      const id=row.operation_id,busy=recovering.has(id),stage=STAGES[row.stage];
      const fields=[['תאריך פעולה',date(row.verified_at||row.created_at)],['סכום המסמך',moneyFormat.format(Number(row.amount))],
        ['צ׳קים לרישום',!row.resolved_at&&row.check_count?`${row.check_count} · ${moneyFormat.format(Number(row.check_amount))}`:''],
        ['כשל ראשון',date(row.first_failed_at)],['ניסיון אחרון',date(row.last_attempt_at)],['ניסיון אוטומטי הבא',date(row.next_retry_at)],
        ['ניסיונות שנכשלו או דרשו אימות',row.attempts||''],['הושלם',date(row.resolved_at)]];
      return `<li><strong>${stage[0]}</strong><span class="morning-operation-state">${busy?'מתבצעת בדיקה':severity(row)}</span>
        <p>${TYPES[row.document_type]} ${escape(row.document_number||'')}</p>
        <dl>${fields.filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        ${stage[1]?`<p>${stage[1]} יש להימנע מהפקה נוספת או מהזנה חוזרת של הצ׳קים.</p>`:''}
        <div class="sync-incidents-actions">
          ${row.resolved_at?'':button('retry','בדוק מצב הפקה',id,busy)}
          ${row.verified_at&&UUID.test(row.document_id||'')?button('document','פתח מסמך',id):''}
          ${debtAction?.(row)?button('debt','פתח חוב',id):''}
          ${row.resolved_at||acknowledged.has(ackKey(row))?'':button('ack','קראתי',id)}
        </div>
        <details><summary>פרטי אבחון</summary><p dir="ltr">${escape(id)}${row.error_code?' · '+escape(row.error_code):''}</p>${button('copy','העתק אבחון',id)}</details>
      </li>`;
    };
    const pending=active(),history=operations.filter(row=>row.resolved_at);
    return `<section class="morning-operation-center" aria-label="פעולות ממתינות ותקלות מערכת">
      <h3>פעולות ממתינות ותקלות מערכת</h3>
      ${!observed?.owner?'<p>יש להתחבר לענן לצפייה בפעולות.</p>':!available?'<p role="status">מצב פעולות מורנינג אינו מעודכן כרגע.</p>':''}
      ${pending.length?`<ul>${pending.slice(0,50).map(card).join('')}</ul>${pending.length>50?'<p>מוצגות 50 פעולות ממתינות.</p>':''}`:available?'<p>אין פעולות מורנינג ממתינות לטיפול.</p>':''}
      ${history.length?`<details><summary>רישומי צ׳קים שהושלמו לאחרונה</summary><ul>${history.map(card).join('')}</ul></details>`:''}
    </section>`;
  }
  return {refresh,action,markup,syncScope,dispose:()=>{closed=true},
    get count(){return active().length},get unread(){return active().filter(row=>!acknowledged.has(ackKey(row))).length}};
}
