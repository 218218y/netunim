import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workerSource=fs.readFileSync(new URL('../netunim-orders/site/assets/js/domains/documents/spreadsheet-preview-worker.js',import.meta.url),'utf8');

function runWorkerOpen(workbook,query='needle',contentSearch={}){
  const posted=[];
  const context={
    importScripts(){},
    XLSX:{
      read(){return workbook},
      utils:{
        decode_range(){return {s:{r:0,c:0},e:{r:0,c:0}}},
        encode_cell({r,c}){return `${r}:${c}`},
      },
    },
    self:{postMessage(message){posted.push(message)}},
    console,
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(workerSource,context,{filename:'spreadsheet-preview-worker.js'});
  context.self.onmessage({data:{id:1,type:'open',query,contentSearch,buffer:new ArrayBuffer(0)}});
  assert.equal(posted.length,1);
  assert.equal(posted[0].ok,true,posted[0].error);
  return posted[0];
}

test('spreadsheet worker searches every worksheet and preserves sheet identity for navigation',()=>{
  const workbook={
    SheetNames:['First','Second'],
    Sheets:{
      First:{'!ref':'A1:A1','!data':[[{v:'needle in first',w:'needle in first'}]]},
      Second:{'!ref':'A1:A1','!data':[[{v:'needle in second',w:'needle in second'}]]},
    },
  };
  const opened=runWorkerOpen(workbook);
  assert.equal(opened.sheets.length,2);
  assert.equal(opened.matches.length,2);
  assert.equal(Array.from(opened.matches,match=>match.sheet).join(','),'0,1');
  assert.equal(Array.from(opened.matches,match=>match.text).join('|'),'needle in first|needle in second');
});


test('spreadsheet worker highlights advanced AND, OR and ordered proximity matches',()=>{
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A1','!data':[[{v:'מה אחד שני שלומך',w:'מה אחד שני שלומך'}]]}}};
  assert.equal(runWorkerOpen(workbook,'מה שלומך',{matchMode:'all'}).matches.length,2);
  assert.equal(runWorkerOpen(workbook,'מה חסרה',{matchMode:'any'}).matches.length,1);
  assert.equal(runWorkerOpen(workbook,'מה חסרה',{matchMode:'all'}).matches.length,0);
  const proximity=runWorkerOpen(workbook,'מה שלומך',{matchMode:'proximity',proximityWords:2});
  assert.equal(proximity.matches.length,1);assert.equal(proximity.matches[0].snippet.match,'מה אחד שני שלומך');
  assert.equal(runWorkerOpen(workbook,'מה שלומך',{matchMode:'proximity',proximityWords:1}).matches.length,0);
});


test('spreadsheet worker highlights phone-number variants with one optional prefix separator',()=>{
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A1','!data':[[{v:'0501234567 050-1234567 050 1234567 05-01234567 050-123-4567',w:'0501234567 050-1234567 050 1234567 05-01234567 050-123-4567'}]]}}};
  const opened=runWorkerOpen(workbook,'050 1234567');
  assert.equal(opened.matches.length,4);
  assert.deepEqual(Array.from(opened.matches,match=>match.snippet.match),['0501234567','050-1234567','050 1234567','05-01234567']);
});
