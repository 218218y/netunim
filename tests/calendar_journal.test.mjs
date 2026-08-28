import assert from 'node:assert/strict';
import {createCalendarJournal} from '../netunim-orders/site/assets/js/calendar/journal.js';

function statusError(status,message='failure'){const error=new Error(message);error.status=status;return error}
function storageWith(rows){
  const state=rows.map(row=>({...row}));
  return {
    state,
    async listOperations(){return state.filter(row=>!row.deleted).map(row=>({...row}))},
    async updateOperation(seq,patch){const row=state.find(item=>item.seq===seq);Object.assign(row,patch)},
    async deleteOperation(seq){const row=state.find(item=>item.seq===seq);row.deleted=true},
  };
}

{
  const storage=storageWith([{seq:1,type:'insert',calendarId:'primary',eventId:'abc123',body:{id:'abc123',summary:'תור'},attempts:0}]);
  const calls=[];
  const api={
    async insertEvent(){calls.push('insert');throw statusError(409,'already exists')},
    async getEvent(){calls.push('get');return{id:'abc123',summary:'תור'}},
  };
  const journal=createCalendarJournal({calendarStorage:storage,calendarApi:api});
  assert.equal(await journal.flushPending(),1);
  assert.deepEqual(calls,['insert','get']);
  assert.equal(storage.state[0].deleted,true);
  assert.equal(storage.state[0].attempts,1);
}


{
  const storage=storageWith([{seq:1,type:'insert',calendarId:'primary',eventId:'sameid',body:{id:'sameid',summary:'התור שלנו',start:{date:'2026-08-20'},end:{date:'2026-08-21'}},attempts:0}]);
  const api={
    async insertEvent(){throw statusError(409,'already exists')},
    async getEvent(){return{id:'sameid',summary:'אירוע אחר',start:{date:'2026-08-20'},end:{date:'2026-08-21'}}},
  };
  const journal=createCalendarJournal({calendarStorage:storage,calendarApi:api});
  await assert.rejects(()=>journal.flushPending(),error=>error?.code==='calendar_duplicate_id_conflict');
  assert.notEqual(storage.state[0].deleted,true);
  assert.equal(storage.state[0].lastError,'מזהה האירוע כבר קיים ב-Google אך תוכן האירוע שונה. הפעולה נשמרה בתור ולא אושרה אוטומטית.');
}

{
  const storage=storageWith([{seq:1,type:'delete',calendarId:'primary',eventId:'gone',body:null,attempts:2}]);
  const api={async deleteEvent(){throw statusError(404,'not found')}};
  const journal=createCalendarJournal({calendarStorage:storage,calendarApi:api});
  assert.equal(await journal.flushPending(),1);
  assert.equal(storage.state[0].deleted,true);
  assert.equal(storage.state[0].attempts,3);
}

{
  const storage=storageWith([
    {seq:1,type:'insert',calendarId:'primary',eventId:'e1',body:{id:'e1'},attempts:0},
    {seq:2,type:'patch',calendarId:'primary',eventId:'e1',body:{summary:'חדש'},attempts:0},
    {seq:3,type:'delete',calendarId:'primary',eventId:'e2',body:null,attempts:0},
  ]);
  const calls=[];
  const api={
    async insertEvent(){calls.push('insert:e1');return{id:'e1'}},
    async patchEvent(){calls.push('patch:e1');return{id:'e1'}},
    async deleteEvent(){calls.push('delete:e2');return null},
  };
  const journal=createCalendarJournal({calendarStorage:storage,calendarApi:api});
  assert.equal(await journal.flushPending(),3);
  assert.deepEqual(calls,['insert:e1','patch:e1','delete:e2']);
  assert.ok(storage.state.every(row=>row.deleted));
}

{
  const storage=storageWith([{seq:1,type:'patch',calendarId:'primary',eventId:'e1',body:{summary:'חדש'},attempts:0}]);
  const api={async patchEvent(){throw statusError(0,'network down')}};
  const journal=createCalendarJournal({calendarStorage:storage,calendarApi:api});
  await assert.rejects(()=>journal.flushPending(),/network down/);
  assert.notEqual(storage.state[0].deleted,true);
  assert.equal(storage.state[0].attempts,1);
  assert.equal(storage.state[0].lastError,'network down');
}

console.log('CALENDAR JOURNAL TESTS PASSED');
