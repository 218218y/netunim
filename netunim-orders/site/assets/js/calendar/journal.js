// Ordered durable delivery for Google Calendar mutations. The storage layer commits
// operations before this module sees them, so a browser/network failure cannot erase work.
export function createCalendarJournal({calendarStorage,calendarApi}){
function sameInstant(left,right){const a=new Date(left||''),b=new Date(right||'');return !Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime())&&a.getTime()===b.getTime()}
function sameBoundary(expected,actual){if(expected?.date!=null)return String(expected.date)===String(actual?.date||'');if(expected?.dateTime!=null)return sameInstant(expected.dateTime,actual?.dateTime);return expected==null&&actual==null}
function insertMatches(operation,event){const body=operation?.body||{};return String(event?.id||'')===String(operation?.eventId||'')&&String(event?.summary||'')===String(body.summary||'')&&String(event?.description||'')===String(body.description||'')&&String(event?.location||'')===String(body.location||'')&&sameBoundary(body.start,event?.start)&&sameBoundary(body.end,event?.end)}
async function deliver(operation){
  if(operation.type==='insert'){
    try{return await calendarApi.insertEvent(operation.calendarId,operation.body)}
    catch(error){
      // A lost HTTP response can leave the event successfully created at Google.
      // Retrying the same client-generated event ID returns 409; GET proves that the
      // intended event exists, after which the journal entry can be acknowledged.
      if(error?.status!==409)throw error;
      const existing=await calendarApi.getEvent(operation.calendarId,operation.eventId);
      if(!insertMatches(operation,existing)){const conflict=new Error('מזהה האירוע כבר קיים ב-Google אך תוכן האירוע שונה. הפעולה נשמרה בתור ולא אושרה אוטומטית.');conflict.status=409;conflict.code='calendar_duplicate_id_conflict';throw conflict}
      return existing;
    }
  }
  if(operation.type==='patch')return await calendarApi.patchEvent(operation.calendarId,operation.eventId,operation.body);
  if(operation.type==='delete'){
    try{return await calendarApi.deleteEvent(operation.calendarId,operation.eventId)}
    catch(error){if(error?.status===404||error?.status===410)return null;throw error}
  }
  throw new Error('פעולת יומן מקומית לא מוכרת');
}

async function flushPending(){
  const operations=await calendarStorage.listOperations();
  let delivered=0;
  for(const operation of operations){
    await calendarStorage.updateOperation(operation.seq,{attempts:Number(operation.attempts||0)+1,lastAttemptAt:new Date().toISOString(),lastError:''});
    try{
      await deliver(operation);
      await calendarStorage.deleteOperation(operation.seq);
      delivered++;
    }catch(error){
      await calendarStorage.updateOperation(operation.seq,{lastError:error?.message||'השליחה ל-Google נכשלה'});
      throw error;
    }
  }
  return delivered;
}

return {deliver,flushPending};
}
