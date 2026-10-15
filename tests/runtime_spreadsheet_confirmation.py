"""Actual IndexedDB flight retention/reload plus account-epoch confirmation."""
from browser_harness import BrowserSession, ROOT
import json


SCRIPT = r"""(async()=>{
  await (await import('./assets/js/main.js')).appReady;
  const {createSpreadsheetSync}=await import('./assets/js/shared/spreadsheet-sync.js');
  const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
  const {createDefaultNotesSheet}=await import('./assets/js/shared/notes-sheet-model.js');
  const app=__APP__,phase=__PHASE__,store=createSpreadsheetStore(),owner='confirmation-'+app;
  const make=value=>{const state=createDefaultNotesSheet();state.rows=[{id:'row',sheetId:state.sheets[0].id,cells:{[state.columns[0].id]:value},createdAt:'',updatedAt:''}];return state};
  let epoch=1,current=owner,release,entered,replyPhase=phase;
  const entry=new Promise(resolve=>{entered=resolve}),hold=new Promise(resolve=>{release=resolve}),calls=[];
  const sync=createSpreadsheetSync({domain:app,store,account:()=>current,accountScope:()=>({owner:current,epoch}),
    enabled:()=>true,online:()=>true,setTimer:()=>0,clearTimer:()=>{},request:async(path,options)=>{
      if(!options.method)return new Response(JSON.stringify([{revision:4,state:make('base')}]));
      const payload=JSON.parse(options.body);calls.push(options.body);
      const result={revision:replyPhase==='pending'?4:5,state:payload.p_state,operation_replayed:replyPhase==='retry'};
      if(replyPhase==='epoch')return {ok:true,status:200,text:async()=>{entered();await hold;return JSON.stringify([result])}};
      return new Response(JSON.stringify([result]));
    }});
  const key=owner+':'+app+':main',before=await store.load(key);
  const opened=await sync.open();if(!opened)throw Error(sync.error);
  if(phase==='retry'){
    const after=await store.load(key);
    return {recovered:sync.revision===5&&sync.status==='saved',cleared:after.record.flight===null,
      samePayload:calls[0]===JSON.stringify(before.record.flight.payload),working:after.record.working.rows[0].cells['sheet-main-col-1']};
  }
  sync.model.state.notesSheet.rows[0].cells['sheet-main-col-1']='changed';sync.changed();
  const task=sync.flush();
  if(phase==='epoch'){await entry;current='other';epoch++;current=owner;epoch++;release()}
  const accepted=await task,after=await store.load(key);
  return {accepted,retained:!!after.record.flight,revision:sync.revision,base:after.record.base.rows[0].cells['sheet-main-col-1'],
    working:after.record.working.rows[0].cells['sheet-main-col-1'],exactPayload:calls[0]===JSON.stringify(after.record.flight.payload),
    otherNamespace:(await store.load('other:'+app+':main')).record===null};
})()"""


for app in ['kupa', 'orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-spreadsheet-confirmation', instrument=False) as browser:
        def run(phase):
            return browser.evaluate(SCRIPT.replace('__APP__', json.dumps(app)).replace('__PHASE__', json.dumps(phase)))
        pending = run('pending')
        assert pending == {'accepted': False, 'retained': True, 'revision': 4, 'base': 'base',
                           'working': 'changed', 'exactPayload': True, 'otherNamespace': True}, pending
        browser._navigate()
        retried = run('retry')
        assert retried == {'recovered': True, 'cleared': True, 'samePayload': True, 'working': 'changed'}, retried
        # Use a fresh isolated owner for the held-body epoch case. The first
        # namespace above remains an independently verified completed record.
        epoch_script = SCRIPT.replace("'confirmation-'+app", "'confirmation-epoch-'+app")
        epoch = browser.evaluate(epoch_script.replace('__APP__', json.dumps(app)).replace('__PHASE__', json.dumps('epoch')))
        assert epoch == pending, epoch
        assert not browser.drain_serious_errors()
        print('PASS', app, 'native IDB malformed ACK retention; reload exact retry; A/B/A body scope;',
              json.dumps({'pending': pending, 'retry': retried, 'epoch': epoch}), flush=True)
