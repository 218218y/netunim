import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createDocumentTextMatcher} from '../shared/document-text-search.js';
import {contentMatchRanges, contentSearchMatches} from '../netunim-orders/document-bridge/lib.mjs';
import {findTextMatchOffsets} from '../netunim-orders/site/assets/js/domains/documents/document-search-navigator.js';

function bridge(text, query, options) {
  const result = contentMatchRanges(text, query, options);
  return {matches: result.ranges.map(row => ({start: row.index, end: row.index + row.length})), capped: result.capped};
}

test('all checks every required term after the highlight cap is filled', () => {
  const text = 'אב '.repeat(6000);
  for (const match of [bridge, findTextMatchOffsets]) {
    assert.deepEqual(match(text, 'אב אין', {matchMode: 'all'}).matches, []);
    assert.equal(match(text + 'אין', 'אב אין', {matchMode: 'all'}).matches.length, 5000);
    assert.deepEqual(match(text, 'אב אין', {matchMode: 'all', maxMatches: 1}).matches, []);
  }
});

test('Bridge matching preserves its existing control-character and 240-character wire-query normalization',()=>{
  assert.equal(contentSearchMatches('אב סוף','אב\u0000סוף'),true);
  assert.deepEqual(bridge('אב סוף','אב\u0000סוף').matches,[{start:0,end:6}]);
  const bounded='אב'.repeat(120),longer=bounded+'סוף';
  assert.equal(contentSearchMatches(bounded,longer),true);
  assert.deepEqual(bridge(bounded,longer).matches,[{start:0,end:bounded.length}]);
});

test('proximity missing suffix completes on thousands of repetitions in a separate bounded process', () => {
  const script = `
    import {contentSearchMatches,contentMatchRanges} from './netunim-orders/document-bridge/lib.mjs';
    import {findTextMatchOffsets} from './netunim-orders/site/assets/js/domains/documents/document-search-navigator.js';
    const text='אב '.repeat(10000),query='אב אב אב אב אב אין',options={matchMode:'proximity',proximityWords:50};
    if(contentSearchMatches(text,query,options)||contentMatchRanges(text,query,options).ranges.length||findTextMatchOffsets(text,query,options).matches.length)process.exit(1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), timeout: 3000, encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('Bridge and DOM preserve greedy ordered proximity, punctuation, Unicode boundaries and zero distance', () => {
  const cases = [
    ['אב אב סוף', 'אב סוף', 1, 'partial', [{start: 0, end: 9}]],
    ['אב אב סוף', 'אב סוף', 0, 'partial', [{start: 3, end: 9}]],
    ['Xאב אמצע סוף!', 'אב סוף', 1, 'partial', [{start: 1, end: 12}]],
    ['אב, סוף', 'אב סוף', 0, 'partial', []],
    ['אב, סוף', 'אב, סוף', 0, 'whole', [{start: 0, end: 7}]],
    ['אב\n\tסוף!', 'אב סוף', 0, 'whole', [{start: 0, end: 7}]],
    ['סוף אב', 'אב סוף', 50, 'partial', []],
    ['אב אב אב', 'אב אב אב', 0, 'whole', [{start: 0, end: 8}]],
    ['a+b c? a+b c?', 'a+b c?', 0, 'partial', [{start: 0, end: 6}, {start: 7, end: 13}]],
  ];
  for (const [text, query, proximityWords, wordMatch, expected] of cases) {
    const options = {matchMode: 'proximity', proximityWords, wordMatch};
    assert.deepEqual(bridge(text, query, options).matches, expected, JSON.stringify({text, query, options}));
    assert.deepEqual(findTextMatchOffsets(text, query, options).matches, expected);
    assert.equal(contentSearchMatches(text, query, options), expected.length > 0);
  }
});

test('small exhaustive cases retain the former regex proximity ranges', () => {
  // The reference is deliberately limited to tiny inputs. Never run the old
  // combinatorial regex against the adversarial performance fixture above.
  const words = ['אב', 'גד', 'Xאב', 'אב,'];
  for (let value = 0; value < 256; value++) {
    let code = value;
    const tokens = Array.from({length: 4}, () => { const word = words[code % 4]; code >>= 2; return word; });
    const text = tokens.join(' ');
    for (const query of ['אב גד', 'אב אב גד', 'אב אב']) for (const distance of [0, 1, 2]) {
      const pattern = query.split(' ').join(`(?:\\s+\\S+){0,${distance}}\\s+`);
      const expected = Array.from(text.matchAll(new RegExp(pattern, 'gu')), row => ({start: row.index, end: row.index + row[0].length}));
      assert.deepEqual(bridge(text, query, {matchMode: 'proximity', proximityWords: distance}).matches, expected, `${text} / ${query} / ${distance}`);
    }
  }
});

test('classic worker and installed Bridge derive exactly from the dependency-free canonical matcher', () => {
  const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n?/g,'\n');
  const canonical=read('../shared/document-text-search.js');
  const program=parse(canonical,{ecmaVersion:'latest',sourceType:'module'});
  assert.ok(program.body.every(node=>!node.type.startsWith('Import')&&(!node.type.startsWith('Export')||node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration')));
  const classic=canonical.replace(/^export (?=function )/gm,'');
  const installed=read('../netunim-orders/document-bridge/document-text-search.mjs');
  assert.equal(installed,canonical);
  for(const app of ['orders','kupa']){
    const code=read(`../netunim-${app}/site/assets/js/shared/document-text-search-worker.js`);
    assert.equal(code,classic);
    const context=vm.createContext({});vm.runInContext(code,context,{timeout:1000});
    const result=context.createDocumentTextMatcher('אב אין',{matchMode:'all'}).find('אב '.repeat(6000));
    assert.equal(result.matches.length,0);
  }
});

test('Unicode whole-word boundaries and case expansion retain original highlight coordinates',()=>{
  for(const match of [bridge,findTextMatchOffsets]){
    assert.deepEqual(match('𐐀abc abc𐐀 abc','abc',{wordMatch:'whole'}).matches,[{start:12,end:15}]);
    assert.deepEqual(match('a\uDC00abc abc','abc',{wordMatch:'whole'}).matches,[{start:2,end:5},{start:6,end:9}]);
    const text='İ AB אב סוף';
    assert.deepEqual(match(text,'ab').matches,[{start:2,end:4}]);
    assert.deepEqual(match(text,'אב סוף',{matchMode:'proximity'}).matches,[{start:5,end:11}]);
  }
  const matcher=createDocumentTextMatcher('אב אין',{matchMode:'any'});
  assert.deepEqual(matcher.find('אב '.repeat(6000)+'אין',{maxMatches:1}).foundTerms,['אב','אין']);
});
