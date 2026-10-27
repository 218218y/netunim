import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpensePdfPreview} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-pdf-preview.js';

test('late preview cleanup cannot query or overwrite the next screen after ownership ends',async()=>{
  const previous=globalThis.document;let active=true,queries=0;
  globalThis.document={querySelector:()=>{queries++;return null;}};
  try{
    const preview=createExpensePdfPreview({isActive:()=>active,run:work=>work(),capture:()=>()=>{if(!active)throw Error('old screen');}});
    const pending=preview.select({type:'application/pdf',file:new Blob(['%PDF-1.4 private'])});
    assert.equal(queries,1);active=false;await pending;assert.equal(queries,1,'cleanup accessed the new screen');
    preview.reset();await preview.select({type:'application/pdf',file:new Blob(['%PDF old'])});assert.equal(queries,1);
    preview.reset();
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
