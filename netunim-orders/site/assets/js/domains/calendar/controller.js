import {applyPending,eventKey,writableCalendar,editableEvent,eventReadOnlyReason} from './read-model.js';
import {projectCalendarPresentation} from './presentation.js';
import {createCalendarEditorPayload} from './editor-payload.js';
import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {createCalendarDisplayLifetime} from '../../calendar/display-lifetime.js';
import {createCalendarCommitObserver} from '../../calendar/commit-observer.js';
import {authorizeCalendarDisplay} from '../../calendar/display-access.js';
import {googleCalendarConfig} from '../../calendar/config.js';
import {addDaysKey,calendarPrefetchRangeFor,calendarRangeContains,calendarRangeFor,localDateKey,moveFocusDate,normalizeFocusDate,normalizeViewMode,parseDateKey,reconcileCalendarEndDate} from '../../calendar/view.js';

export function createDomainsCalendarController({ui,tab,calendarUi,calendarSession,effects,calendarStorage,connection,mountViewLayout,modal,closeModal,toast,confirmDialog,dateEditorMarkup,setDateValue,subscribeAccountScope,subscribeCalendarCommits=()=>()=>{}}){
const {readEditorPayload,readQuickEditorPayload}=createCalendarEditorPayload({field:$});
let started=false,disposed=false;
let ownedView=null,ownedModal=null,editorAuthority=null,displayOwner='',renderGeneration=0;
const actions=createRuntimeTaskOwner();
const lifetime=createCalendarDisplayLifetime({captureOperation:()=>connection.captureOperation(),subscribeAccountScope,onInvalidate:invalidateDisplay});
const commitObserver=createCalendarCommitObserver({
  subscribe:subscribeCalendarCommits,
  capture(){
    if(!calendarSession.accountVerified)return null;
    const authority=lifetime.capture(),accountId=calendarSession.accountId;
    return {owner:authority.owner,assertCurrent(){authority.assertCurrent();if(!calendarSession.accountVerified||accountId!==calendarSession.accountId)throw Object.assign(new Error('Calendar display account changed'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}};
  },
  refresh:observeCommittedCalendar,
  onError(error,authority){authority.assertCurrent();calendarSession.queueObservationError='לא ניתן לאמת את השינויים המקומיים ביומן. רענן כדי לבדוק שוב; התור נשמר.';updateCalendarStatus();console.warn('Calendar committed queue read failed',error)},
});
async function observeCommittedCalendar(authority){
  const range=calendarRange(),display=await calendarStorage.readDisplaySnapshot(authority.owner,range.startKey,range.endKey);
  authority.assertCurrent();
  if(calendarRange().key!==range.key)return false;
  if(!display||display.snapshot.accountId!==calendarSession.accountId){clearDisplayModel();renderCalendarBody();throw new Error('calendar_committed_display_unavailable')}
  // Publication is synchronous inside a fresh native queue transaction. A hint
  // neither acknowledges Google nor authorizes retry of an uncertain delivery.
  return calendarStorage.confirmPendingSnapshot(receipt=>{
    authority.assertCurrent();if(calendarRange().key!==range.key||!receipt.isCurrent())return false;
    const current=authorizeCalendarDisplay(display.snapshot,receipt.operations,calendarSession.accountId,authority.owner);
    if(!current)throw new Error('calendar_committed_display_unavailable');
    loadSnapshotIntoUi(current.snapshot,current.pending);calendarSession.queueObservationError='';renderCalendarBody();updateCalendarStatus();return true;
  });
}
const sessionRuntime=connection.createRuntime({authority:lifetime,
  display:{
    isOpen:()=>ui.currentView==='calendar',isPrimary:()=>tab.primaryTab,open:()=>{ui.currentView='calendar'},
    prefetchRange,cacheCovers:range=>loadedRangeCovers(range)&&cacheIsFresh(),containsPrefetch:snapshot=>calendarRangeContains(snapshot,prefetchRange()),
    setCalendars:calendars=>{calendarUi.calendars=calendars},setPending:pending=>{calendarUi.pending=pending},
    clearCache(){calendarUi.events=[];calendarUi.displayEvents=[];calendarUi.pending=[];calendarUi.eventMap=new Map();calendarUi.cacheFetchedAt=null;calendarUi.cacheRangeStart='';calendarUi.cacheRangeEnd=''},
    publish(snapshot,pending){if(ui.currentView==='calendar'&&calendarRangeContains(snapshot,calendarRange())){loadSnapshotIntoUi(snapshot,pending);renderCalendarBody()}},
    render:renderCalendarBody,status:updateCalendarStatus,
  },
});
function stale(error){return ['CALENDAR_OPERATION_SCOPE_CHANGED','calendar_cloud_auth_required'].includes(error?.code)}
function captureEdit({fresh=false}={}){const authority=!fresh&&ownedModal?.isConnected&&editorAuthority?editorAuthority:lifetime.capture();authority.assertCurrent();if(displayOwner!==authority.owner&&!calendarSession.accountVerified)throw new Error('יש לאמת את חשבון היומן לפני הצגת המטמון או שמירת שינוי. התור המקומי נשמר.');return authority}
function clearDisplayModel(){displayOwner='';calendarUi.calendars=[];calendarUi.events=[];calendarUi.displayEvents=[];calendarUi.pending=[];calendarUi.eventMap=new Map();calendarUi.cacheFetchedAt=null;calendarUi.cacheRangeStart='';calendarUi.cacheRangeEnd=''}
function lockedMarkup(){return '<p class="notice" role="status">התצוגה השמורה דורשת אימות חשבון. התחבר לענן ורענן את Google Calendar. השינויים הממתינים נשארים שמורים במחשב.</p>'}
function invalidateDisplay(){
  renderGeneration++;effects.invalidate();
  editorAuthority=null;clearDisplayModel();connection.hasUsableToken();calendarSession.lastSyncAt=null;calendarSession.lastError='';calendarSession.queueObservationError='';
  if(ownedModal?.isConnected)modal('יומן — יש לאמת את ההתחברות',lockedMarkup(),'<button class="btn" data-action="close-modal">סגור</button>');ownedModal=null;
  if(ownedView?.isConnected){const body=ownedView.querySelector('#calendarBody');if(body)body.innerHTML=lockedMarkup();updateCalendarStatus()}
}
function showCalendarModal(...args){editorAuthority=captureEdit({fresh:true});modal(...args);ownedModal=$('.calendar-event-form,.calendar-quick-form,.calendar-readonly-details')}
function frame(run){const assertCurrent=lifetime.checkpoint();effects.frame(()=>{try{assertCurrent();run()}catch(error){if(!stale(error))throw error}})}

const shortDateTimeFormatter=new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const longDateFormatter=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

function pad(value){return String(value).padStart(2,'0')}
function currentViewMode(){calendarUi.viewMode=normalizeViewMode(calendarUi.viewMode);return calendarUi.viewMode}
function currentFocusKey(){calendarUi.focusDate=normalizeFocusDate(calendarUi.focusDate);return calendarUi.focusDate}
function calendarRange(){return calendarRangeFor(currentFocusKey(),currentViewMode())}
function prefetchRange(){return calendarPrefetchRangeFor(currentFocusKey())}
function loadedRange(){return{rangeStart:String(calendarUi.cacheRangeStart||''),rangeEnd:String(calendarUi.cacheRangeEnd||'')}}
function loadedRangeCovers(range){return calendarRangeContains(loadedRange(),range)}
function cacheIsFresh(){const fetched=Date.parse(String(calendarUi.cacheFetchedAt||''));return Number.isFinite(fetched)&&Date.now()-fetched<Math.max(30_000,Number(googleCalendarConfig.pollIntervalMs||60_000))}
function changePeriod(delta){calendarUi.focusDate=moveFocusDate(currentFocusKey(),currentViewMode(),delta);renderCalendar({alignFocus:true})}
function goToday(){const previousRange=calendarRange().key;calendarUi.focusDate=localDateKey(new Date());if(ui.currentView==='calendar'&&calendarRange().key===previousRange){alignFocusInScroller();return}renderCalendar({alignFocus:true})}
function setViewMode(mode){const next=normalizeViewMode(mode);if(next===currentViewMode())return;calendarUi.viewMode=next;renderCalendar({alignFocus:true})}

function primaryWritableCalendar(){return (calendarUi.calendars||[]).find(calendar=>calendar.primary&&writableCalendar(calendar))||(calendarUi.calendars||[]).find(writableCalendar)||null}

function rebuildEventMap(){calendarUi.eventMap=new Map();for(const event of calendarUi.displayEvents||[])calendarUi.eventMap.set(eventKey(event._calendarId,event.id),event)}
function loadSnapshotIntoUi(snapshot,pending){displayOwner=snapshot?.owner||'';calendarUi.calendars=snapshot?.calendars||[];calendarUi.events=snapshot?.events||[];calendarUi.pending=pending||[];calendarUi.displayEvents=applyPending(snapshot,pending,calendarUi.calendars);if(snapshot?.rangeStart&&snapshot?.rangeEnd){calendarUi.cacheRangeStart=String(snapshot.rangeStart);calendarUi.cacheRangeEnd=String(snapshot.rangeEnd)}if(snapshot?.fetchedAt)calendarUi.cacheFetchedAt=snapshot.fetchedAt;rebuildEventMap()}
function lastSyncText(){if(!calendarSession.lastSyncAt)return '';const date=new Date(calendarSession.lastSyncAt);return Number.isNaN(date.getTime())?'':shortDateTimeFormatter.format(date)}
function statusDescriptor(){if(!displayOwner&&!calendarSession.accountVerified&&!calendarSession.syncing&&!sessionRuntime.isReconnecting())return{className:'offline',text:'נדרש אימות חשבון להצגת היומן השמור'};const pending=(calendarUi.pending||[]).length;if(sessionRuntime.isReconnecting())return{className:'pending',text:`מתחבר מחדש ל-Google${pending?` · ${pending} ממתינים`:''}`};if(calendarSession.syncing)return{className:'pending',text:`מסנכרן מול Google${pending?` · ${pending} ממתינים`:''}`};if(!effects.isOnline())return{className:'offline',text:`אופליין${pending?` · ${pending} שינויים שמורים וממתינים`:''}`};if(calendarSession.queueObservationError)return{className:'error',text:calendarSession.queueObservationError};if(calendarSession.lastError)return{className:'error',text:`${calendarSession.lastError}${pending?` · ${pending} ממתינים`:''}`};if(connection.hasUsableToken())return{className:pending?'pending':'synced',text:`מחובר ל-Google${pending?` · ${pending} ממתינים`:lastSyncText()?` · עודכן ${lastSyncText()}`:''}`};if(pending)return{className:'offline',text:`${pending} שינויים שמורים מקומית · התחבר ל-Google כדי לשלוח`};return{className:'offline',text:connection.configured()?'לא מחובר ל-Google':'נדרשת הגדרת Google OAuth'}}
function updateCalendarStatus(){const el=$('#calendarStatus');if(!el)return;const descriptor=disposed?{className:'offline',text:'תצוגת היומן נסגרה. רענן כדי לפתוח אותה שוב.'}:statusDescriptor();el.className=`calendar-status ${descriptor.className}`;el.textContent=descriptor.text;const authButton=$('#calendarAuthButton');if(authButton){authButton.textContent=sessionRuntime.isReconnecting()?'מתחבר…':connection.hasUsableToken()?'נתק Google':'התחבר ל-Google';authButton.disabled=disposed||!!sessionRuntime.isReconnecting()}const newButton=$('#calendarNewButton');if(newButton)newButton.disabled=disposed||!primaryWritableCalendar()||(connection.hasUsableToken()&&!calendarSession.accountVerified)}

function presentation(){return projectCalendarPresentation({range:calendarRange(),mode:currentViewMode(),events:calendarUi.displayEvents||[],cacheFetchedAt:calendarUi.cacheFetchedAt,online:effects.isOnline(),connected:connection.hasUsableToken(),canCreate:!!primaryWritableCalendar(),now:new Date()},{esc})}
function bodyMarkup(){return presentation().body()}
function toolbarMarkup(){return presentation().toolbar()}
function calendarScroller(){return $('#main')?.querySelector('.calendar-view .view-scroll')||null}
function alignFocusInScroller(){const scroller=calendarScroller();if(!scroller)return;const focus=currentFocusKey(),target=scroller.querySelector(`[data-calendar-day="${focus}"]`);if(!target)return;frame(()=>{if(!target.isConnected||!scroller.isConnected)return;const scrollerRect=scroller.getBoundingClientRect(),targetRect=target.getBoundingClientRect(),maxTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight),centerOffset=Math.max(0,(scroller.clientHeight-targetRect.height)/2),desired=scroller.scrollTop+(targetRect.top-scrollerRect.top)-centerOffset;scroller.scrollTop=Math.max(0,Math.min(maxTop,desired))})}
function renderCalendarBody({alignFocus=false}={}){if(disposed||ui.currentView!=='calendar'||!ownedView?.isConnected)return;const body=$('#calendarBody'),scroller=calendarScroller(),scrollTop=scroller?.scrollTop||0,scrollLeft=scroller?.scrollLeft||0;if(body)body.innerHTML=bodyMarkup();updateCalendarStatus();if(alignFocus)alignFocusInScroller();else if(scroller)frame(()=>{if(scroller.isConnected){scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft}})}

async function renderCalendarContent({alignFocus=true}={}){
  if(disposed)return false;
  currentViewMode();currentFocusKey();const range=calendarRange(),generation=++renderGeneration;
  let authority;try{authority=lifetime.capture()}catch(error){if(!stale(error))throw error}
  const memoryCovered=!!authority&&displayOwner===authority.owner&&loadedRangeCovers(range),initialBody=memoryCovered?bodyMarkup():authority?'<div class="calendar-loading">טוען יומן…</div>':lockedMarkup();
  $('#main').innerHTML=`<div class="calendar-view">${toolbarMarkup()}<div id="calendarBody" class="calendar-body calendar-body-${range.mode}">${initialBody}</div></div>`;
  mountViewLayout({sourceSelector:'.calendar-view',headCount:1,className:'calendar-view'});ownedView=$('#main .calendar-view');updateCalendarStatus();
  if(!authority){clearDisplayModel();return false}
  if(memoryCovered){if(alignFocus)alignFocusInScroller()}
  else try{
    const display=await calendarStorage.readDisplaySnapshot(authority.owner,range.startKey,range.endKey);authority.assertCurrent();
    if(ui.currentView!=='calendar'||generation!==renderGeneration||calendarRange().key!==range.key||!ownedView?.isConnected)return false;
    if(display){loadSnapshotIntoUi(display.snapshot,display.pending);calendarSession.accountId=String(display.snapshot.accountId);renderCalendarBody({alignFocus})}
    else{clearDisplayModel();ownedView.querySelector('#calendarBody').innerHTML=lockedMarkup();updateCalendarStatus()}
  }catch(error){if(stale(error))return false;calendarSession.lastError='טעינת המטמון המקומי נכשלה';console.error(error);if(generation===renderGeneration)renderCalendarBody({alignFocus})}
  authority.assertCurrent();if(connection.hasUsableToken()&&effects.isOnline())sessionRuntime.wake(()=>sessionRuntime.syncNow({quiet:true,force:false}));return true;
}

function newGoogleEventId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')}
function localInputParts(value){const date=new Date(value||'');if(Number.isNaN(date.getTime()))return{date:localDateKey(new Date()),time:'09:00'};return{date:localDateKey(date),time:`${pad(date.getHours())}:${pad(date.getMinutes())}`}}
function allDayDisplayEnd(event){const end=String(event?.end?.date||event?.start?.date||'');return end?addDaysKey(end,-1):String(event?.start?.date||'')}
function writableCalendarOptions(selectedId){return (calendarUi.calendars||[]).filter(writableCalendar).map(calendar=>`<option value="${esc(calendar.id)}" ${calendar.id===selectedId?'selected':''}>${esc(calendar.summary||calendar.id)}</option>`).join('')}
function editorDateDefaults(dayKey){const date=dayKey||localDateKey(new Date());return{startDate:date,endDate:date,startTime:'09:00',endTime:'10:00',allDay:false}}
function endDateManual(fields){return String(fields?.endDate||'')>String(fields?.startDate||'')}
function focusCalendarField(selector){frame(()=>{const field=$(selector);if(field?.isConnected){field.focus();field.select?.()}})}
function openQuickCalendarEditor(dayKey){try{captureEdit({fresh:true})}catch(error){return toast(error.message)}const writable=primaryWritableCalendar();if(!writable)return toast('יש להתחבר ל-Google לפחות פעם אחת כדי לבחור יומן לכתיבה.');const fields=editorDateDefaults(dayKey),date=parseDateKey(fields.startDate);showCalendarModal('הוספה מהירה',`<div class="calendar-quick-form"><div class="calendar-quick-date">${esc(longDateFormatter.format(date))}</div><div class="field full"><label>שם / כותרת</label><input id="calendarQuickSummary" autocomplete="off"></div><div class="calendar-quick-times"><div class="field"><label>משעה</label><input id="calendarQuickStartTime" type="time" value="${esc(fields.startTime)}"></div><div class="field"><label>עד שעה</label><input id="calendarQuickEndTime" type="time" value="${esc(fields.endTime)}"></div></div><input id="calendarQuickDate" type="hidden" value="${esc(fields.startDate)}"><div class="calendar-quick-note">לפרטים נוספים, יומן אחר, מיקום או אירוע רב-יומי אפשר לפתוח את הטופס המלא.</div></div>`,`<button class="btn primary" data-action="calendar-quick-save">הוסף</button><button class="btn" data-action="calendar-quick-details">כל הפרטים</button><button class="btn" data-action="close-modal">ביטול</button>`);focusCalendarField('#calendarQuickSummary')}
function calendarDayCreate(dayKey,event){effects.dayClick.cancel();if(Number(event?.detail||0)>=2){openCalendarEditor({dayKey});return}let authority;try{authority=captureEdit()}catch(error){return toast(error.message)}const rangeKey=calendarRange().key;effects.dayClick.schedule(()=>{try{authority.assertCurrent()}catch(error){if(!stale(error))console.error(error);return}if(ui.currentView!=='calendar'||calendarRange().key!==rangeKey)return;openQuickCalendarEditor(dayKey)})}
function quickEditorPrefill(){return{summary:$('#calendarQuickSummary')?.value||'',startTime:$('#calendarQuickStartTime')?.value||'09:00',endTime:$('#calendarQuickEndTime')?.value||'10:00',startDate:$('#calendarQuickDate')?.value||localDateKey(new Date())}}
function expandQuickCalendarEvent(){const prefill=quickEditorPrefill();openCalendarEditor({dayKey:prefill.startDate,prefill})}
function syncCalendarStartDate(element){const startDate=String(element?.value||'');if(!parseDateKey(startDate))return;const end=$('#calendarEndDate');if(!end)return;const result=reconcileCalendarEndDate(startDate,end.value,{endWasManual:end.dataset.calendarEndManual==='1',source:'start'}),editor=end.closest('[data-date-editor]');if(editor)editor.dataset.dateMin=startDate;if(result.endDate!==end.value)setDateValue(end,result.endDate,false);end.dataset.calendarEndManual=result.endManual?'1':'0'}
function syncCalendarEndDate(element){const end=element||$('#calendarEndDate'),start=$('#calendarStartDate');if(!end||!start||!parseDateKey(start.value))return;const result=reconcileCalendarEndDate(start.value,end.value,{endWasManual:end.dataset.calendarEndManual==='1',source:'end'}),editor=end.closest('[data-date-editor]');if(editor)editor.dataset.dateMin=start.value;if(result.endDate!==end.value)setDateValue(end,result.endDate,false);end.dataset.calendarEndManual=result.endManual?'1':'0'}

function openCalendarEvent(key){try{captureEdit({fresh:true})}catch(error){return toast(error.message)}const event=calendarUi.eventMap?.get(key);if(!event)return toast('האירוע כבר אינו בתצוגה. רענן את היומן.');if(!editableEvent(event)){const start=event.start?.date||event.start?.dateTime||'',when=start?shortDateTimeFormatter.format(new Date(event.start?.dateTime||`${start}T00:00:00`)):'';showCalendarModal(event.summary||'אירוע',`<div class="calendar-readonly-details"><div><b>יומן:</b> ${esc(event._calendarSummary||'')}</div>${when?`<div><b>מועד:</b> ${esc(when)}</div>`:''}${event.location?`<div><b>מיקום:</b> ${esc(event.location)}</div>`:''}${event.description?`<div class="calendar-description">${esc(event.description)}</div>`:''}<div class="notice">${esc(eventReadOnlyReason(event))}</div></div>`,`<button class="btn" data-action="close-modal">סגור</button>`);return}openCalendarEditor({event,key})}
function openCalendarEditor({event=null,key='',dayKey='',prefill=null}={}){try{captureEdit({fresh:true})}catch(error){return toast(error.message)}const writable=primaryWritableCalendar();if(!event&&!writable)return toast('יש להתחבר ל-Google לפחות פעם אחת כדי לבחור יומן לכתיבה.');let fields={...editorDateDefaults(dayKey),...(prefill||{})},calendarId=event?._calendarId||writable?.id||'';if(event){const allDay=!!event.start?.date;if(allDay)fields={allDay:true,startDate:event.start.date,endDate:allDayDisplayEnd(event),startTime:'',endTime:''};else{const start=localInputParts(event.start?.dateTime),end=localInputParts(event.end?.dateTime);fields={allDay:false,startDate:start.date,endDate:end.date,startTime:start.time,endTime:end.time}}}const calendarField=event?`<input value="${esc(event._calendarSummary||calendarId)}" disabled>`:`<select id="calendarCalendarId">${writableCalendarOptions(calendarId)}</select>`,summary=event?.summary??prefill?.summary??'',endManual=endDateManual(fields);showCalendarModal(event?'עריכת תור':'תור חדש',`<div class="form-grid calendar-event-form"><div class="field full"><label>כותרת</label><input id="calendarSummary" value="${esc(summary)}" autocomplete="off"></div><div class="field full"><label>יומן</label>${calendarField}</div><div class="field full calendar-all-day-field"><label><input id="calendarAllDay" type="checkbox" ${fields.allDay?'checked':''} data-change="calendar-toggle-all-day"> אירוע לכל היום</label></div><div class="field"><label>מתאריך</label>${dateEditorMarkup('calendarStartDate',fields.startDate,{label:'מתאריך',change:'calendar-start-date-change'})}</div><div class="field"><label>עד תאריך</label>${dateEditorMarkup('calendarEndDate',fields.endDate,{label:'עד תאריך',minDate:fields.startDate,change:'calendar-end-date-change',data:{'calendar-end-manual':endManual?'1':'0'}})}</div><div id="calendarTimeFields" class="calendar-time-fields ${fields.allDay?'hidden':''}"><div class="field"><label>שעת התחלה</label><input id="calendarStartTime" type="time" value="${esc(fields.startTime)}"></div><div class="field"><label>שעת סיום</label><input id="calendarEndTime" type="time" value="${esc(fields.endTime)}"></div></div><div class="field full"><label>מיקום</label><input id="calendarLocation" value="${esc(event?.location||'')}"></div><div class="field full"><label>פרטים</label><textarea id="calendarDescription" class="large-textarea">${esc(event?.description||'')}</textarea></div></div>`,`<button class="btn primary" data-action="calendar-save-event" data-click-arg0="${esc(key)}">שמור</button>${event?`<button class="btn danger" data-action="calendar-delete-event" data-click-arg0="${esc(key)}">מחק</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`);if(!event)focusCalendarField('#calendarSummary')}
function toggleCalendarAllDay(element){const fields=$('#calendarTimeFields');if(fields)fields.classList.toggle('hidden',!!element.checked)}

async function queueCalendarMutation({existing=null,body,calendarId=''}){const authority=captureEdit(),surface=ownedModal;let operation;if(existing){if(!editableEvent(existing))throw new Error(eventReadOnlyReason(existing));operation={type:'patch',calendarId:existing._calendarId,eventId:existing.id,body,baseEtag:existing.etag||''}}else{const targetCalendarId=calendarId||primaryWritableCalendar()?.id||'';if(!targetCalendarId)throw new Error('לא נמצא יומן עם הרשאת כתיבה');const eventId=newGoogleEventId();operation={type:'insert',calendarId:targetCalendarId,eventId,body:{id:eventId,...body}}}authority.assertCurrent();await calendarStorage.addOperation(operation);authority.assertCurrent();if(surface?.isConnected&&ownedModal===surface){closeModal();ownedModal=null;editorAuthority=null}await refreshPendingOverlay(authority);authority.assertCurrent();toast(effects.isOnline()&&connection.hasUsableToken()?'השינוי נשמר מקומית ונשלח ל-Google':'השינוי נשמר בבטחה וממתין לסנכרון');if(effects.isOnline()&&connection.hasUsableToken())sessionRuntime.wake(()=>sessionRuntime.syncNow({quiet:true}))}
async function saveQuickCalendarEvent(){try{if(connection.hasUsableToken()&&!calendarSession.accountVerified)throw new Error('יש להמתין לסיום אימות חשבון Google לפני שמירת שינוי ביומן');await queueCalendarMutation({body:readQuickEditorPayload(),calendarId:primaryWritableCalendar()?.id||''})}catch(error){if(!stale(error))toast(error?.message||'שמירת התור נכשלה');return false}}
async function saveCalendarEvent(key=''){try{if(connection.hasUsableToken()&&!calendarSession.accountVerified)throw new Error('יש להמתין לסיום אימות חשבון Google לפני שמירת שינוי ביומן');const existing=key?calendarUi.eventMap?.get(key):null,body=readEditorPayload(existing),calendarId=existing?'':$('#calendarCalendarId')?.value||primaryWritableCalendar()?.id||'';await queueCalendarMutation({existing,body,calendarId})}catch(error){if(!stale(error))toast(error?.message||'שמירת התור נכשלה');return false}}
async function refreshPendingOverlay(authority=lifetime.capture()){
  const range=calendarRange(),display=await calendarStorage.readDisplaySnapshot(authority.owner,range.startKey,range.endKey);authority.assertCurrent();
  if(display)loadSnapshotIntoUi(display.snapshot,display.pending);else clearDisplayModel();renderCalendarBody();
}
async function deleteCalendarEvent(key){
  try{
    const authority=captureEdit(),surface=ownedModal,event=calendarUi.eventMap?.get(key);
    if(!event||!editableEvent(event))return toast(eventReadOnlyReason(event));
    if(!await confirmDialog('מחיקת תור',`למחוק את התור „${event.summary||'ללא כותרת'}”?`,{confirmText:'מחק תור',signal:authority.signal}))return false;
    authority.assertCurrent();await calendarStorage.addOperation({type:'delete',calendarId:event._calendarId,eventId:event.id});authority.assertCurrent();
    if(surface?.isConnected&&ownedModal===surface){closeModal();ownedModal=null;editorAuthority=null}
    await refreshPendingOverlay(authority);authority.assertCurrent();toast(effects.isOnline()&&connection.hasUsableToken()?'המחיקה נשמרה ונשלחת ל-Google':'המחיקה נשמרה וממתינה לסנכרון');
    if(effects.isOnline()&&connection.hasUsableToken())sessionRuntime.wake(()=>sessionRuntime.syncNow({quiet:true}));return true;
  }catch(error){if(!stale(error))toast(error?.message||'שמירת המחיקה נכשלה');return false}
}

function newEvent(dayKey=''){openCalendarEditor({dayKey:dayKey||localDateKey(new Date())})}

function dispose(){
  if(disposed)return false;
  disposed=true;
  commitObserver.dispose();
  sessionRuntime.dispose();actions.close();
  lifetime.dispose();return true;
}

function renderCalendar(...args){return disposed?Promise.resolve(false):actions.run(()=>renderCalendarContent(...args))}
function guard(run){return (...args)=>disposed?false:run(...args)}
function command(run){return (...args)=>disposed?Promise.resolve(false):actions.run(()=>run(...args))}
async function drain(){
  do{
    await Promise.all([actions.drain(),sessionRuntime.drain(),commitObserver.drain()]);
  }
  while(actions.isPending()||sessionRuntime.isPending()||commitObserver.isPending());
}
function start(){if(disposed||started)return false;started=true;commitObserver.start();try{return sessionRuntime.start()}catch(error){dispose();throw error}}
const runtime={start,dispose,drain,isPending:()=>actions.isPending()||sessionRuntime.isPending()||commitObserver.isPending()};
return {
  start,dispose,runtime,renderCalendar,
  changePeriod:guard(changePeriod),goToday:guard(goToday),setViewMode:guard(setViewMode),
  refreshCalendar:sessionRuntime.refreshCalendar,calendarAuthAction:sessionRuntime.calendarAuthAction,resumeAfterCloudLogin:sessionRuntime.resumeAfterCloudLogin,
  newEvent:guard(newEvent),calendarDayCreate:guard(calendarDayCreate),openCalendarEvent:guard(openCalendarEvent),
  toggleCalendarAllDay:guard(toggleCalendarAllDay),syncCalendarStartDate:guard(syncCalendarStartDate),syncCalendarEndDate:guard(syncCalendarEndDate),
  saveQuickCalendarEvent:command(saveQuickCalendarEvent),expandQuickCalendarEvent:guard(expandQuickCalendarEvent),
  saveCalendarEvent:command(saveCalendarEvent),deleteCalendarEvent:command(deleteCalendarEvent),syncNow:sessionRuntime.syncNow,
};
}
