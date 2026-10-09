// Ordered durable delivery for Google Calendar mutations. The storage layer commits
// operations before this module sees them, so a browser/network failure cannot erase work.
export function createCalendarJournal({calendarStorage,calendarApi,operationScope}){
if(typeof operationScope?.captureOperation!=='function')throw new TypeError('calendar_journal_authority_required');
function sameInstant(left,right){const a=new Date(left||''),b=new Date(right||'');return !Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime())&&a.getTime()===b.getTime()}
function sameBoundary(expected,actual){if(expected?.date!=null)return String(expected.date)===String(actual?.date||'');if(expected?.dateTime!=null)return sameInstant(expected.dateTime,actual?.dateTime);return expected==null&&actual==null}
function insertMatches(operation,event){const body=operation?.body||{};return String(event?.id||'')===String(operation?.eventId||'')&&String(event?.summary||'')===String(body.summary||'')&&String(event?.description||'')===String(body.description||'')&&String(event?.location||'')===String(body.location||'')&&sameBoundary(body.start,event?.start)&&sameBoundary(body.end,event?.end)}
function capture({assertCurrent=()=>{}}={}){assertCurrent();const authority=operationScope.captureOperation();return ()=>{assertCurrent();authority.assertCurrent()}}
async function deliver(operation,options){
  const assertCurrent=capture(options),scope={assertCurrent};
  if(operation.type==='insert'){
    try{return await calendarApi.insertEvent(operation.calendarId,operation.body,scope)}
    catch(error){
      // A lost HTTP response can leave the event successfully created at Google.
      // Retrying the same client-generated event ID returns 409; GET proves that the
      // intended event exists, after which the journal entry can be acknowledged.
      if(error?.status!==409)throw error;
      assertCurrent();const existing=await calendarApi.getEvent(operation.calendarId,operation.eventId,scope);assertCurrent();
      if(!insertMatches(operation,existing)){const conflict=new Error('מזהה האירוע כבר קיים ב-Google אך תוכן האירוע שונה. הפעולה נשמרה בתור ולא אושרה אוטומטית.');conflict.status=409;conflict.code='calendar_duplicate_id_conflict';throw conflict}
      return existing;
    }
  }
  if(operation.type==='patch')return await calendarApi.patchEvent(operation.calendarId,operation.eventId,operation.body,scope);
  if(operation.type==='delete'){
    try{return await calendarApi.deleteEvent(operation.calendarId,operation.eventId,scope)}
    catch(error){if(error?.status===404||error?.status===410)return null;throw error}
  }
  throw new Error('פעולת יומן מקומית לא מוכרת');
}

async function flushPending(options){
  const assertCurrent=capture(options),operations=await calendarStorage.listOperations();assertCurrent();
  let delivered=0;
  for(const operation of operations){
    assertCurrent();
    await calendarStorage.updateOperation(operation.seq,{attempts:Number(operation.attempts||0)+1,lastAttemptAt:new Date().toISOString(),lastError:''});
    assertCurrent();
    try{
      await deliver(operation,{assertCurrent});assertCurrent();
      await calendarStorage.deleteOperation(operation.seq);
      delivered++;
      assertCurrent();
    }catch(error){
      if(error?.code==='CALENDAR_OPERATION_SCOPE_CHANGED')throw error;
      assertCurrent();
      await calendarStorage.updateOperation(operation.seq,{lastError:error?.message||'השליחה ל-Google נכשלה'});
      throw error;
    }
  }
  return delivered;
}

return {deliver,flushPending};
}
