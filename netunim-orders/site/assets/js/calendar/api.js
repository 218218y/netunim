const API_ROOT='https://www.googleapis.com/calendar/v3';

export function createCalendarApi({calendarAuth}){
  if(typeof calendarAuth?.captureOperation!=='function'||typeof calendarAuth?.rejectToken!=='function')throw new TypeError('calendar_api_authority_required');
  function apiError(message,status=0,payload=null){return Object.assign(new Error(message||'Google Calendar החזיר שגיאה'),{status:Number(status||0),payload})}
  function context({assertCurrent=()=>{}}={}){
    assertCurrent();const operation=calendarAuth.captureOperation();
    return {assertCurrent:()=>{assertCurrent();operation.assertCurrent()},accessToken:operation.accessToken};
  }
  async function calendarFetch(scope,path,opt={}){
    scope.assertCurrent();const token=scope.accessToken();let response;
    try{response=await fetch(API_ROOT+path,{...opt,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(opt.headers||{})}})}
    catch(error){scope.assertCurrent();throw apiError(error?.message||'אין חיבור ל-Google Calendar',0)}
    scope.assertCurrent();const text=await response.text();scope.assertCurrent();
    let payload=null;try{payload=text?JSON.parse(text):null}catch{payload=null}
    if(response.status===401)calendarAuth.rejectToken(token);
    if(!response.ok)throw apiError(payload?.error?.message||payload?.message||`Google Calendar: HTTP ${response.status}`,response.status,payload);
    return payload;
  }
  function params(query={}){const search=new URLSearchParams();for(const [key,value] of Object.entries(query)){if(value==null||value==='')continue;if(Array.isArray(value))value.forEach(item=>search.append(key,String(item)));else search.set(key,String(value))}const text=search.toString();return text?'?'+text:''}
  async function listCalendars(options){
    const scope=context(options),items=[];let pageToken='';
    do{const data=await calendarFetch(scope,'/users/me/calendarList'+params({maxResults:250,showHidden:true,pageToken}));items.push(...(Array.isArray(data?.items)?data.items:[]));pageToken=String(data?.nextPageToken||'')}while(pageToken);
    scope.assertCurrent();return items.filter(calendar=>!calendar?.deleted);
  }
  async function listEvents(scope,calendarId,{timeMin,timeMax}){
    const items=[];let pageToken='';
    do{const data=await calendarFetch(scope,`/calendars/${encodeURIComponent(calendarId)}/events`+params({singleEvents:true,showDeleted:false,timeMin,timeMax,maxResults:2500,orderBy:'startTime',pageToken}));items.push(...(Array.isArray(data?.items)?data.items:[]));pageToken=String(data?.nextPageToken||'')}while(pageToken);
    scope.assertCurrent();return items;
  }
  async function listCalendarEvents(calendarId,range,options){return listEvents(context(options),calendarId,range)}
  function canReadEventDetails(calendar){return ['reader','writerWithoutPrivateAccess','writer','owner'].includes(String(calendar?.accessRole||''))}
  async function fetchEvents(calendars,range,options){
    const scope=context(options),readable=(Array.isArray(calendars)?calendars:[]).filter(canReadEventDetails),groups=new Array(readable.length),workerCount=Math.min(4,readable.length);let cursor=0;
    async function worker(){while(cursor<readable.length){scope.assertCurrent();const index=cursor++,calendar=readable[index],events=await listEvents(scope,calendar.id,range);groups[index]=events.map(event=>({...event,_calendarId:calendar.id,_calendarSummary:calendar.summary||calendar.id,_calendarColor:calendar.backgroundColor||'',_calendarAccessRole:calendar.accessRole||''}))}}
    await Promise.all(Array.from({length:workerCount},()=>worker()));scope.assertCurrent();return groups.flat();
  }
  async function getEvent(calendarId,eventId,options){return calendarFetch(context(options),`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)}
  async function insertEvent(calendarId,event,options){return calendarFetch(context(options),`/calendars/${encodeURIComponent(calendarId)}/events`+params({sendUpdates:'none'}),{method:'POST',body:JSON.stringify(event)})}
  async function patchEvent(calendarId,eventId,patch,options){return calendarFetch(context(options),`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`+params({sendUpdates:'none'}),{method:'PATCH',body:JSON.stringify(patch)})}
  async function deleteEvent(calendarId,eventId,options){return calendarFetch(context(options),`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`+params({sendUpdates:'none'}),{method:'DELETE'})}
  return {listCalendars,listCalendarEvents,fetchEvents,getEvent,insertEvent,patchEvent,deleteEvent};
}
