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


test('shared document navigator keeps whole-word matching aligned with Bridge semantics',()=>{
  const text='מזר מזרן, מזר. cat catalog cat';
  assert.equal(findTextMatchOffsets(text,'מזר').matches.length,3);
  const whole=findTextMatchOffsets(text,'מזר',{wordMatch:'whole'});
  assert.deepEqual(whole.matches.map(row=>text.slice(row.start,row.end)),['מזר','מזר']);
  assert.equal(findTextMatchOffsets(text,'cat',{wordMatch:'whole'}).matches.length,2);
  assert.equal(findTextMatchOffsets('abc_def','abc',{wordMatch:'whole'}).matches.length,1,'punctuation boundaries stay aligned with Everything whole-word matching');
  assert.equal(findTextMatchOffsets('מה שלומך123','מה שלומך',{matchMode:'proximity',proximityWords:0,wordMatch:'whole'}).matches.length,0);
  assert.equal(findTextMatchOffsets('מה שלומך!','מה שלומך',{matchMode:'proximity',proximityWords:0,wordMatch:'whole'}).matches.length,1);
  assert.equal(findTextMatchOffsets('מזרן כרית','מזר כרית',{matchMode:'all',wordMatch:'whole'}).matches.length,0);
  assert.equal(findTextMatchOffsets('מזרן כרית','מזר כרית',{matchMode:'any',wordMatch:'whole'}).matches.length,1);
});

test('shared document navigator keeps phone-number separator variants aligned with content search',()=>{
  const text='0501234567 | 050-1234567 | 050 1234567 | 05-01234567 | 050-123-4567';
  const result=findTextMatchOffsets(text,'050-1234567');
  assert.equal(result.matches.length,4);
  assert.deepEqual(result.matches.map(row=>text.slice(row.start,row.end)),['0501234567','050-1234567','050 1234567','05-01234567']);
  const viewerQueries=buildViewerFindQuery('050 1234567');
  assert.ok(Array.isArray(viewerQueries));
  for(const value of ['0501234567','050-1234567','050 1234567','05-01234567','05 01234567'])assert.ok(viewerQueries.includes(value));
  assert.equal(viewerQueries.includes('050-123-4567'),false);
});
