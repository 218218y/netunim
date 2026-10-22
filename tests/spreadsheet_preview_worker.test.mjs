import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workerSource=fs.readFileSync(new URL('../netunim-orders/site/assets/js/domains/documents/spreadsheet-preview-worker.js',import.meta.url),'utf8');

function runWorkerOpen(workbook,query='needle',contentSearch={}){
  const posted=[];
  const context={
    importScripts(...paths){
      for(const name of paths)if(name.endsWith('document-text-search-worker.js')){
        const code=fs.readFileSync(new URL('../netunim-orders/site/assets/js/shared/document-text-search-worker.js',import.meta.url),'utf8');
        vm.runInContext(code,context,{filename:name,timeout:2000});
      }
    },
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
  vm.runInContext(workerSource,context,{filename:'spreadsheet-preview-worker.js',timeout:2000});
  context.input={id:1,type:'open',query,contentSearch,buffer:new ArrayBuffer(0)};
  vm.runInContext('self.onmessage({data:input})',context,{timeout:3000});
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


test('spreadsheet worker can switch independently between partial-token and whole-word matching',()=>{
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A1','!data':[[{v:'מזר מזרן, מזר',w:'מזר מזרן, מזר'}]]}}};
  assert.equal(runWorkerOpen(workbook,'מזר',{wordMatch:'partial'}).matches.length,3);
  const whole=runWorkerOpen(workbook,'מזר',{wordMatch:'whole'});
  assert.equal(whole.matches.length,2);
  assert.deepEqual(Array.from(whole.matches,match=>match.snippet.match),['מזר','מזר']);
  const underscore={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A1','!data':[[{v:'abc_def',w:'abc_def'}]]}}};
  assert.equal(runWorkerOpen(underscore,'abc',{wordMatch:'whole'}).matches.length,1);
  assert.equal(runWorkerOpen(workbook,'מזר כרית',{matchMode:'all',wordMatch:'whole'}).matches.length,0);
});

test('spreadsheet worker highlights phone-number variants with one optional prefix separator',()=>{
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A1','!data':[[{v:'0501234567 050-1234567 050 1234567 05-01234567 050-123-4567',w:'0501234567 050-1234567 050 1234567 05-01234567 050-123-4567'}]]}}};
  const opened=runWorkerOpen(workbook,'050 1234567');
  assert.equal(opened.matches.length,4);
  assert.deepEqual(Array.from(opened.matches,match=>match.snippet.match),['0501234567','050-1234567','050 1234567','05-01234567']);
});

test('workbook-wide all presence survives a full highlight cap in an earlier cell or sheet',()=>{
  const workbook={SheetNames:['Frequent','Rare'],Sheets:{
    Frequent:{'!ref':'A1:A1','!data':[[{v:'אב '.repeat(6000)}]]},
    Rare:{'!ref':'A1:A1','!data':[[{v:'אין'}]]},
  }};
  assert.equal(runWorkerOpen(workbook,'אב אין',{matchMode:'all'}).matches.length,5000);
  workbook.Sheets.Rare['!data'][0][0].v='חסר';
  assert.equal(runWorkerOpen(workbook,'אב אין',{matchMode:'all'}).matches.length,0);
  workbook.Sheets.Frequent['!data'][0][0].v='אב '.repeat(6000)+'אין';
  assert.equal(runWorkerOpen(workbook,'אב אין',{matchMode:'all'}).matches.length,5000);
});

test('spreadsheet ordered proximity has bounded work on a long missing suffix',()=>{
  const workbook={SheetNames:['Repeated'],Sheets:{Repeated:{'!ref':'A1:A1','!data':[[{v:'אב '.repeat(10000)}]]}}};
  assert.equal(runWorkerOpen(workbook,'אב אב אב אב אב אין',{matchMode:'proximity',proximityWords:50}).matches.length,0);
});

test('spreadsheet all with a spaced phone query uses phone presence rather than separate digits',()=>{
  const workbook={SheetNames:['Phone'],Sheets:{Phone:{'!ref':'A1:A1','!data':[[{v:'050-1234567'}]]}}};
  assert.equal(runWorkerOpen(workbook,'050 1234567',{matchMode:'all'}).matches.length,1);
});
