import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextMatchSnippet,findTextMatchOffsets} from '../netunim-orders/site/assets/js/domains/documents/document-search-navigator.js';

test('shared document navigator finds every non-overlapping match and reports bounded snippets',()=>{
  const text='פתיחה מילה אחת באמצע, ואז מילה אחת בסוף';
  const result=findTextMatchOffsets(text,'מילה אחת');
  assert.equal(result.matches.length,2);assert.equal(result.capped,false);
  const snippet=buildTextMatchSnippet(text,result.matches[1],{contextChars:12});
  assert.equal(snippet.match,'מילה אחת');assert.ok(snippet.before.includes('ואז'));
});

test('shared document navigator caps pathological documents without changing case-insensitive semantics',()=>{
  const result=findTextMatchOffsets('Abc abc ABC abc','abc',{maxMatches:3});
  assert.deepEqual(result.matches.map(row=>row.start),[0,4,8]);assert.equal(result.capped,true);
});
