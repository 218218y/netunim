import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextMatchSnippet,buildViewerFindQuery,findTextMatchOffsets} from '../netunim-orders/site/assets/js/domains/documents/document-search-navigator.js';

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


test('shared document navigator mirrors advanced content-search AND, OR and ordered proximity semantics',()=>{
  const text='פתיחה מה אחד שני שלומך. וגם מילה אחרת.';
  assert.equal(findTextMatchOffsets(text,'מה שלומך',{matchMode:'phrase'}).matches.length,0);
  assert.equal(findTextMatchOffsets(text,'מה שלומך',{matchMode:'all'}).matches.length,2);
  assert.equal(findTextMatchOffsets(text,'מה חסרה',{matchMode:'all'}).matches.length,0);
  assert.equal(findTextMatchOffsets(text,'מה חסרה',{matchMode:'any'}).matches.length,1);
  const close=findTextMatchOffsets(text,'מה שלומך',{matchMode:'proximity',proximityWords:2});
  assert.equal(close.matches.length,1);assert.equal(text.slice(close.matches[0].start,close.matches[0].end),'מה אחד שני שלומך');
  assert.equal(findTextMatchOffsets(text,'מה שלומך',{matchMode:'proximity',proximityWords:1}).matches.length,0);
  assert.deepEqual(buildViewerFindQuery('מה שלומך',{matchMode:'all'}),['מה','שלומך']);
  assert.deepEqual(buildViewerFindQuery('מה שלומך',{matchMode:'any'}),['מה','שלומך']);
  assert.equal(buildViewerFindQuery('מה שלומך',{matchMode:'proximity',proximityWords:2}),'מה שלומך');
});
