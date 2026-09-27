import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPdfPreviewSrc,buildPdfTextDirective,buildPdfTextDirectives} from '../netunim-orders/site/assets/js/domains/documents/pdf-text-fragments.js';

test('PDF text fragment directives use surrounding context to distinguish repeated matches',()=>{
  const first={before:'פתיחה של הקטע הראשון',match:'מילת חיפוש',after:'המשך ראשון ושונה'};
  const second={before:'פתיחה אחרת לפני הקטע השני',match:'מילת חיפוש',after:'המשך שני ושונה'};
  const a=buildPdfTextDirective(first,'מילת חיפוש');
  const b=buildPdfTextDirective(second,'מילת חיפוש');
  assert.notEqual(a,b);
  assert.match(a,/-,/);
  assert.match(a,/,-/);
  assert.doesNotMatch(a,/מילת חיפוש/,'text directive values must be URL encoded');
});

test('PDF preview keeps every match highlighted and moves the selected match to the first directive',()=>{
  const info={active:true,query:'match',count:3,snippets:[
    {before:'alpha one',match:'match',after:'omega one'},
    {before:'alpha two',match:'match',after:'omega two'},
    {before:'alpha three',match:'match',after:'omega three'},
  ]};
  const original=buildPdfTextDirectives(info,{activeIndex:0});
  const selected=buildPdfTextDirectives(info,{activeIndex:2});
  assert.equal(original.length,3);
  assert.equal(selected.length,3);
  assert.equal(selected[0],original[2]);
  assert.deepEqual(new Set(selected),new Set(original));
  const src=buildPdfPreviewSrc('blob:test',{matchInfo:info,activeIndex:2});
  assert.match(src,/blob:test#toolbar=0&navpanes=0&view=FitH&:~:text=/);
  assert.equal((src.match(/text=/g)||[]).length,3);
});

test('PDF preview falls back to a single query fragment until detailed matches arrive',()=>{
  const src=buildPdfPreviewSrc('blob:test',{query:'מילה-אחת'});
  assert.match(src,/:~:text=/);
  assert.match(src,/%2D/,'dash must be encoded because it is structural in text fragments');
});
