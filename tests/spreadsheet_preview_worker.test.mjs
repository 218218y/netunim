import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workerSource=fs.readFileSync(new URL('../netunim-orders/site/assets/js/domains/documents/spreadsheet-preview-worker.js',import.meta.url),'utf8');

function runWorkerOpen(workbook,query='needle'){
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
  context.self.onmessage({data:{id:1,type:'open',query,buffer:new ArrayBuffer(0)}});
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
