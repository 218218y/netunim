import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpreadsheetSync,SPREADSHEET_IDLE_MS,SPREADSHEET_DRAFT_MS} from '../shared/spreadsheet-sync.js';
import {assertSpreadsheet,mergeSpreadsheets,spreadsheetDeleteIntents,migrateLegacySpreadsheet} from '../shared/spreadsheet-model.js';
import {createDefaultNotesSheet} from '../shared/notes-sheet-model.js';
const clone=structuredClone;
function book(){const b=createDefaultNotesSheet();b.rows=[{id:'R',sheetId:'sheet-main',cells:{[b.columns[0].id]:'initial'},createdAt:'',updatedAt:''}];return b}
function fixture(){
  const db=new Map(),journals=new Map(),emergency=new Map(),timers=new Map(),operations=new Map();let seq=0;
  const f={owner:'owner',online:true,remote:{revision:1,state:book()},calls:[],dropAck:false,delay:null};
  f.store={load:async k=>({record:clone(db.get(k)||null),drafts:clone(journals.get(k)||[])}),commit:async(k,v)=>{db.set(k,clone(v));journals.delete(k)},journal:async(k,v)=>journals.set(k,clone(v)),saveEmergency:(k,v)=>emergency.set(k,clone(v)),readEmergency:k=>clone(emergency.get(k)||[])};
  f.create=()=>createSpreadsheetSync({domain:'orders',account:()=>f.owner,online:()=>f.online,enabled:()=>true,store:f.store,setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimer:id=>timers.delete(id),request:async(path,options)=>{
    if(!f.online)throw new Error('offline');
    if(!options.method)return new Response(JSON.stringify([f.remote]));
    const body=JSON.parse(options.body);f.calls.push({path,body});
    if(f.delay){const delay=f.delay;f.delay=null;await delay}
    if(!operations.has(body.p_operation_id)){
      if(body.p_expected_revision!==f.remote.revision)return new Response(JSON.stringify({code:'40001',message:'revision_conflict'}),{status:409});
      const state=path.includes('restore_')?book():body.p_state;
      if(JSON.stringify(f.remote.state)!==JSON.stringify(state))f.remote={revision:f.remote.revision+1,state:clone(state)};
      operations.set(body.p_operation_id,true);
    }
    if(f.dropAck){f.dropAck=false;throw new Error('lost ACK')}
    return new Response(JSON.stringify([f.remote]));
  }});
  f.run=async ms=>{for(const [id,timer] of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn()}await new Promise(resolve=>setImmediate(resolve));};
  f.edit=(sync,value,column=0)=>{const b=sync.model.state.notesSheet,row=b.rows[0],id=b.columns[column].id;row.cells[id]=value;row.updatedAt='2026-09-17';sync.changed({rowId:row.id,columnId:id,value,updatedAt:row.updatedAt})};
  f.db=db;return f;
}
test('100 rapid edits use one workbook RPC; blur/poll do not generate writes',async()=>{
  const f=fixture(),s=f.create();await s.open();for(let i=0;i<100;i++)f.edit(s,String(i));assert.equal(f.calls.length,0);
  await f.run(SPREADSHEET_DRAFT_MS);assert.equal(s.metrics.journals,1);
  await f.run(SPREADSHEET_IDLE_MS);assert.equal(f.calls.length,1);assert.equal(s.revision,2);assert.equal(s.status,'saved');
  for(let i=0;i<5;i++)await s.poll();await s.flush();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].body.p_state.rows[0].cells['sheet-main-col-1'],'99');assert.ok(!('notesSheet' in f.calls[0].body.p_state));
});
test('offline draft survives reopening without blur and merges independent remote cells',async()=>{
  const f=fixture(),s=f.create();await s.open();f.online=false;f.edit(s,'local');await f.run(SPREADSHEET_DRAFT_MS);s.pagehide();
  f.remote.state.rows[0].cells['sheet-main-col-2']='remote';f.remote.revision++;
  const reopened=f.create();await reopened.open();assert.equal(reopened.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'local');
  f.online=true;await reopened.flush();await reopened.flush();assert.equal(f.remote.state.rows[0].cells['sheet-main-col-1'],'local');assert.equal(f.remote.state.rows[0].cells['sheet-main-col-2'],'remote');
});
test('lost acknowledgement survives restart with the exact persisted operation id',async()=>{
  const f=fixture(),s=f.create();await s.open();f.edit(s,'accepted');f.dropAck=true;await s.flush();assert.equal(f.remote.revision,2);
  const reopened=f.create();await reopened.open();assert.equal(reopened.revision,2);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].body,f.calls[1].body);assert.equal(reopened.status,'saved');
});
test('edits while RPC is in flight are retained for the next idle window',async()=>{
  const f=fixture(),s=f.create();await s.open();let release;f.delay=new Promise(resolve=>{release=resolve});f.edit(s,'first');const pending=s.flush();await new Promise(resolve=>setImmediate(resolve));f.edit(s,'second');release();await pending;
  assert.equal(s.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'second');assert.equal(f.calls.length,1);await f.run(SPREADSHEET_IDLE_MS);assert.equal(f.calls.length,2);assert.equal(f.remote.state.rows[0].cells['sheet-main-col-1'],'second');
});
test('same-cell conflict preserves local recovery copy and blocks cloud overwrite',async()=>{
  const f=fixture(),s=f.create();await s.open();f.edit(s,'local');f.remote.state.rows[0].cells['sheet-main-col-1']='remote';f.remote.revision++;
  await s.flush();assert.equal(s.status,'conflict');assert.equal(s.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'local');const count=f.calls.length;await s.flush();assert.equal(f.calls.length,count);
  await s.useRemoteAfterExport();assert.equal(s.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'remote');
});
test('restore retry has a durable identity and cannot create duplicate restores',async()=>{
  const f=fixture(),s=f.create();await s.open();f.edit(s,'new');await s.flush();f.dropAck=true;await assert.rejects(s.restore(1));assert.equal(f.remote.revision,3);
  const reopened=f.create();await reopened.open();assert.equal(reopened.revision,3);assert.deepEqual(f.calls.at(-1).body,f.calls.at(-2).body);
});
test('invalid cells, references and IDs fail closed without normalization loss',()=>{
  for(const cells of [[],null,{'unknown':'x'},{'sheet-main-col-1':{x:1}}]){const b=book();b.rows[0].cells=cells;assert.throws(()=>assertSpreadsheet(b))}
  const b=book();b.rows[0].id=b.columns[0].id;assert.throws(()=>assertSpreadsheet(b));
  const bad=book();bad.rows[0].cells.unknown='data';assert.throws(()=>migrateLegacySpreadsheet(bad));
});
test('delete versus remote update and parent deletion versus new children conflict',()=>{
  const base=book(),local=clone(base),remote=clone(base);local.rows=[];remote.rows[0].cells['sheet-main-col-1']='remote';
  assert.ok(mergeSpreadsheets(base,local,remote,spreadsheetDeleteIntents(base,local)).conflicts.length);
  const column=clone(base);column.columns.splice(0,1);column.rows[0].cells={};assert.ok(mergeSpreadsheets(base,column,remote,spreadsheetDeleteIntents(base,column)).conflicts.length);
});
test('storage failure prevents RPC and reports recovery state',async()=>{
  const f=fixture(),s=f.create();await s.open();f.edit(s,'local');f.store.commit=async()=>{throw new Error('disk full')};assert.equal(await s.flush(),false);assert.equal(f.calls.length,0);assert.equal(s.status,'error');
});
test('offline legacy cutover survives structural edits and a second browser open',async()=>{
  const f=fixture(),s=f.create();await s.captureLegacy(book());f.online=false;await s.open();f.edit(s,'offline legacy draft');
  s.model.state.notesSheet.rows.push({id:'added-offline',sheetId:'sheet-main',cells:{},createdAt:'',updatedAt:''});s.changed(null);await s.flush({send:false});
  const reopened=f.create();await reopened.open();assert.equal(reopened.model.state.notesSheet.rows.length,2);assert.equal(reopened.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'offline legacy draft');
  f.online=true;await reopened.flush();assert.equal(f.remote.state.rows.length,2);assert.equal(f.remote.state.rows[0].cells['sheet-main-col-1'],'offline legacy draft');
});
test('account switch saves the previous draft only in its original namespace',async()=>{
  const f=fixture(),s=f.create();await s.open();f.edit(s,'private A');f.owner='owner-B';await s.open();assert.equal(s.model.state.notesSheet.rows[0].cells['sheet-main-col-1'],'initial');
  assert.equal(f.db.get('owner:orders:main').working.rows[0].cells['sheet-main-col-1'],'private A');assert.equal(f.calls.length,0);
});
test('missing delete intent blocks storage-to-cloud deletion; confirmed deletion survives restart',async()=>{
  const f=fixture(),s=f.create();await s.open();s.model.state.notesSheet.rows=[];s.changed(null);assert.equal(await s.flush(),false);assert.equal(f.calls.length,0);assert.equal(s.status,'error');
  const other=f.create();await other.open();other.model.state.notesSheet.rows=[];other.changed(null,{deleteIntents:{'notesSheet.rows':['R']}});f.online=false;await other.flush({send:false});
  const reopened=f.create();await reopened.open();f.online=true;await reopened.flush();assert.equal(f.remote.state.rows.length,0);assert.deepEqual(f.calls[0].body.p_delete_intents,{'notesSheet.rows':['R']});
});
test('confirmed JSON import uses its own snapshot and explicit deletes',async()=>{
  const f=fixture(),s=f.create();await s.open();const imported=book();imported.rows=[];await s.importWorkbook(imported);assert.equal(f.remote.state.rows.length,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.p_kind,'delete');
});
