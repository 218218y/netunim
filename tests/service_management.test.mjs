import test from 'node:test';
import assert from 'node:assert/strict';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';
import {createOrdersServiceRuntime} from '../netunim-orders/site/assets/js/composition/service.js';
import {serviceStatus,serviceFollowUp,compareServiceCalls} from '../netunim-orders/site/assets/js/domains/service/model.js';
import {checkTodayISO} from '../netunim-orders/site/assets/js/core/dates.js';

function fixture(calls){
  const previous={document:globalThis.document,CSS:globalThis.CSS,window:globalThis.window};
  const main={innerHTML:'',querySelector:()=>null},results={innerHTML:''},fields={},saves=[],messages=[],emails=[];
  const {model,serviceUi}=createContexts();model.state={serviceCalls:structuredClone(calls)};
  let revision=0,modal;
  const service=createOrdersServiceRuntime({model,serviceUi,serviceRevision:()=>revision});
  globalThis.document={querySelector:selector=>selector==='#main'?main:selector==='#serviceSearchResults'?results:fields[selector.slice(1)]||null,querySelectorAll:()=>[]};
  globalThis.CSS={escape:String};globalThis.window={open:(...args)=>emails.push(args)};
  service.bindUi({uiLayout:{mountViewLayout:()=>{}},uiModal:{modal:(...args)=>{modal=args},closeModal:()=>{},confirmDialog:async()=>true},uiStatus:{toast:message=>messages.push(message)},uiDateEditor:{dateEditorMarkup:(id,value)=>`<input id="${id}" value="${value}">`},storagePersistence:{scheduleSave:(message,options)=>{revision++;saves.push({message,options})}}});
  const render=()=>{service.renderService({resultsOnly:true});return results.innerHTML};
  const ids=html=>[...html.matchAll(/data-service-bulk-id="([^"]+)"/g)].map(m=>m[1]);
  const action=(name,id,arg)=>service.actions[name]({dataset:{clickArg0:id,clickArg1:arg}});
  function fill(record={}){
    for(const [id,key] of Object.entries({svcName:'customerName',svcOrder:'orderNumber',svcPhone:'phone',svcAddress:'address',svcDesc:'description',svcOpened:'openedAt',svcNext:'nextFollowUp',svcAssignee:'assignee',svcNote:'note'}))fields[id]={value:record[key]||''};
    for(const [id,key] of Object.entries({svcSent:'sent',svcFollow:'followUp',svcUrgent:'escalated'}))fields[id]={checked:!!record[key]};
  }
  return {model,serviceUi,service,main,render,ids,action,fill,saves,messages,emails,get modal(){return modal},restore(){for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}
const call=(id,extra={})=>({id,customerName:'לקוח '+id,description:'תיקון דלת',openedAt:'2026-01-01',...extra});

test('service lifecycle includes all unfinished calls regardless of overlapping legacy flags',()=>{
  for(const flags of [{},{sent:true},{followUp:true},{escalated:true},{sent:true,followUp:true,escalated:true}])assert.equal(serviceStatus(flags).key,'open');
  assert.equal(serviceStatus({closed:true,escalated:true}).key,'closed');
  const h=fixture([call('plain'),call('sent',{sent:true}),call('follow',{followUp:true}),call('urgent',{escalated:true}),call('closed',{closed:true})]);
  try{
    assert.deepEqual(new Set(h.ids(h.render())),new Set(['plain','sent','follow','urgent']));
    h.service.renderService();assert.match(h.main.innerHTML,/<table class="service-table">/);assert.doesNotMatch(h.main.innerHTML,/service-card|workflow-btn|הקפצה/);
    assert.equal((h.main.innerHTML.match(/data-action="service-filter"/g)||[]).length,3);
    h.action('service-filter','closed');assert.deepEqual(h.ids(h.render()),['closed']);
  }finally{h.restore()}
});

test('follow-up attention uses real dates, includes overdue and excludes closed calls',()=>{
  assert.equal(serviceFollowUp({nextFollowUp:'2026-11-16'},'2026-11-17').overdue,true);
  assert.equal(serviceFollowUp({nextFollowUp:'2026-11-17'},'2026-11-17').due,true);
  assert.equal(serviceFollowUp({nextFollowUp:'2026-11-18'},'2026-11-17').due,false);
  for(const value of ['', 'invalid','2026-02-30'])assert.equal(serviceFollowUp({nextFollowUp:value},'2026-11-17'),null);
  assert.equal(serviceFollowUp({nextFollowUp:'2026-11-17',closed:true}),null);
  const today=checkTodayISO(),future='2999-01-01',h=fixture([call('today',{nextFollowUp:today}),call('late',{nextFollowUp:'2020-01-01'}),call('future',{nextFollowUp:future}),call('flagOnly',{followUp:true}),call('closed',{nextFollowUp:today,closed:true})]);
  try{h.action('service-filter','due');assert.deepEqual(h.ids(h.render()),['late','today'])}finally{h.restore()}
});

test('today view advances across days without a data revision',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,16,12).getTime()});
  const h=fixture([call('tomorrow',{nextFollowUp:'2026-11-17'})]);
  try{h.action('service-filter','due');assert.deepEqual(h.ids(h.render()),[]);t.mock.timers.tick(86400000);assert.deepEqual(h.ids(h.render()),['tomorrow'])}finally{h.restore()}
});

test('priority sorting is deterministic and closed calls use closure date',()=>{
  const rows=[call('undated'),call('later',{nextFollowUp:'2026-11-20'}),call('late',{nextFollowUp:'2026-11-01'}),call('urgent',{escalated:true}),call('closedOld',{closed:true,closedAt:'2026-11-01'}),call('closedNew',{closed:true,closedAt:'2026-11-17'})];
  assert.deepEqual(rows.sort(compareServiceCalls).map(c=>c.id),['urgent','late','later','undated','closedNew','closedOld']);
});

test('service search includes assignee and escapes imported text; paging can reveal a global-search target',()=>{
  const h=fixture(Array.from({length:170},(_,i)=>call('s'+String(i).padStart(3,'0'),{assignee:i===169?'אחראי מיוחד':'',note:i===169?'<script>alert(1)</script>':''})));
  try{
    assert.equal(h.ids(h.render()).length,150);
    h.serviceUi.resultTarget='s169';assert.ok(h.ids(h.render()).includes('s169'));
    h.serviceUi.serviceSearch='אחראי מיוחד';const html=h.render();assert.deepEqual(h.ids(html),['s169']);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
    h.serviceUi.serviceSearch='no-match';assert.equal(h.ids(h.render()).length,0);
  }finally{h.restore()}
});

test('close and reopen persist only service and clear stale closure dates without losing original data',()=>{
  const original=call('s1',{followUp:true,sent:true,escalated:true,nextFollowUp:'2026-11-18',source:{sheet:'שירות',rows:[8]},custom:'retained'}),h=fixture([original]);
  try{
    h.render();h.action('toggle-service-flag','s1','closed');assert.equal(h.model.state.serviceCalls[0].closed,true);assert.ok(h.model.state.serviceCalls[0].closedAt);assert.deepEqual(h.ids(h.render()),[]);
    h.action('service-filter','closed');assert.deepEqual(h.ids(h.render()),['s1']);
    h.action('toggle-service-flag','s1','closed');const saved=h.model.state.serviceCalls[0];assert.equal(saved.closedAt,null);assert.equal(saved.closed,false);
    for(const key of ['followUp','sent','escalated','nextFollowUp','source','custom'])assert.deepEqual(saved[key],original[key]);
    assert.deepEqual(h.saves[1].options.domains,['service']);assert.equal(h.saves[1].options.operations[0].mode,'replace');
  }finally{h.restore()}
});

test('editor preserves imported metadata and optional flags, and newly created calls become visible from a closed search',()=>{
  const original=call('s1',{sent:true,followUp:true,source:{sheet:'שירות',rows:[8]},custom:'retained'}),h=fixture([original]);
  try{
    h.action('open-service-modal-2','s1');assert.match(h.modal[1],/id="svcSent" type="checkbox" checked/);assert.match(h.modal[2],/הכנת מייל/);
    h.fill({...original,assignee:'דוד',nextFollowUp:'2026-11-18',escalated:true});h.action('save-service','s1');
    assert.equal(h.model.state.serviceCalls[0].custom,'retained');assert.deepEqual(h.model.state.serviceCalls[0].source,original.source);assert.equal(h.model.state.serviceCalls[0].sent,true);
    h.serviceUi.serviceFilter='closed';h.serviceUi.serviceSearch='old search';h.fill(call('new'));h.action('save-service','');
    assert.equal(h.serviceUi.serviceFilter,'all');assert.equal(h.serviceUi.serviceSearch,'');assert.match(h.main.innerHTML,/לקוח new/);
    const before=h.model.state.serviceCalls.length;h.action('save-service','missing');assert.equal(h.model.state.serviceCalls.length,before);assert.ok(h.messages.length);
  }finally{h.restore()}
});

test('preparing email never marks a call as sent and omits an obsolete closure date on an active call',()=>{
  const h=fixture([call('s1',{closed:false,closedAt:'2026-01-01'})]);
  try{h.action('open-service-gmail','s1');assert.equal(h.emails.length,1);const body=new URL(h.emails[0][0]).searchParams.get('body');assert.match(body,/בטיפול/);assert.doesNotMatch(body,/תאריך סגירה/);assert.equal(h.saves.length,0);assert.equal(h.model.state.serviceCalls[0].sent,undefined)}finally{h.restore()}
});
