import {editableEvent,eventReadOnlyReason} from './read-model.js';

// Accepted commands capture editor authority and the exact modal before any
// confirmation/IDB await. The controller retains their accepted-work drain.
export function createCalendarEditorCommands({calendarSession,calendarUi,connection,calendarStorage,editor,view,effects,sessionRuntime}){
const {captureEdit,primaryWritableCalendar,readEditorPayload,readQuickEditorPayload,newGoogleEventId}=editor;
const {refreshPendingOverlay,toast,confirmDialog,stale}=view;
async function queueCalendarMutation({existing=null,body,calendarId=''}){const authority=captureEdit(),surface=editor.surface();let operation;if(existing){if(!editableEvent(existing))throw new Error(eventReadOnlyReason(existing));operation={type:'patch',calendarId:existing._calendarId,eventId:existing.id,body,baseEtag:existing.etag||''}}else{const targetCalendarId=calendarId||primaryWritableCalendar()?.id||'';if(!targetCalendarId)throw new Error('לא נמצא יומן עם הרשאת כתיבה');const eventId=newGoogleEventId();operation={type:'insert',calendarId:targetCalendarId,eventId,body:{id:eventId,...body}}}authority.assertCurrent();await calendarStorage.addOperation(operation);authority.assertCurrent();editor.closeSurface(surface);await refreshPendingOverlay(authority);authority.assertCurrent();toast(effects.isOnline()&&connection.hasUsableToken()?'השינוי נשמר מקומית ונשלח ל-Google':'השינוי נשמר בבטחה וממתין לסנכרון');if(effects.isOnline()&&connection.hasUsableToken())sessionRuntime.wake(()=>sessionRuntime.syncNow({quiet:true}))}
async function saveQuickCalendarEvent(){try{if(connection.hasUsableToken()&&!calendarSession.accountVerified)throw new Error('יש להמתין לסיום אימות חשבון Google לפני שמירת שינוי ביומן');await queueCalendarMutation({body:readQuickEditorPayload(),calendarId:primaryWritableCalendar()?.id||''})}catch(error){if(!stale(error))toast(error?.message||'שמירת התור נכשלה');return false}}
async function saveCalendarEvent(key=''){try{if(connection.hasUsableToken()&&!calendarSession.accountVerified)throw new Error('יש להמתין לסיום אימות חשבון Google לפני שמירת שינוי ביומן');const existing=key?calendarUi.eventMap?.get(key):null,body=readEditorPayload(existing),calendarId=existing?'':editor.selectedCalendar()||primaryWritableCalendar()?.id||'';await queueCalendarMutation({existing,body,calendarId})}catch(error){if(!stale(error))toast(error?.message||'שמירת התור נכשלה');return false}}
async function deleteCalendarEvent(key){
  try{
    const authority=captureEdit(),surface=editor.surface(),event=calendarUi.eventMap?.get(key);
    if(!event||!editableEvent(event))return toast(eventReadOnlyReason(event));
    if(!await confirmDialog('מחיקת תור',`למחוק את התור „${event.summary||'ללא כותרת'}”?`,{confirmText:'מחק תור',signal:authority.signal}))return false;
    authority.assertCurrent();await calendarStorage.addOperation({type:'delete',calendarId:event._calendarId,eventId:event.id});authority.assertCurrent();
    editor.closeSurface(surface);
    await refreshPendingOverlay(authority);authority.assertCurrent();toast(effects.isOnline()&&connection.hasUsableToken()?'המחיקה נשמרה ונשלחת ל-Google':'המחיקה נשמרה וממתינה לסנכרון');
    if(effects.isOnline()&&connection.hasUsableToken())sessionRuntime.wake(()=>sessionRuntime.syncNow({quiet:true}));return true;
  }catch(error){if(!stale(error))toast(error?.message||'שמירת המחיקה נכשלה');return false}
}

return {saveQuickCalendarEvent,saveCalendarEvent,deleteCalendarEvent};
}
