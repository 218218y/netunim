import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditReadability,measureReadability,readabilityRegressions,auditTextIntegrity,textIntegrityViolations} from '../tools/readability-audit.mjs';

test('canonical UI and shared sources cannot increase long-line counts or maxima',()=>{
  const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/readability-baseline.json',import.meta.url),'utf8'));
  assert.equal(baseline.version,1);
  assert.deepEqual(readabilityRegressions(auditReadability(),baseline.files),[]);
});

test('canonical application and shared strings contain no damaged user text',()=>{
  assert.deepEqual(auditTextIntegrity(),[]);
});

test('text integrity checks cooked literals and template parts without mistaking JavaScript operators for messages',()=>{
  const source=[
    "const a = '?? ???? ??????';",
    'const b = `הודעה ${name}: ?? ????`;',
    String.raw`const c = '\u003f\u003f \u003f\u003f';`,
    String.raw`const d = 'bad\uFFFDtext';`,
  ].join('\n');
  assert.deepEqual(textIntegrityViolations(source).map(({line,reason})=>({line,reason})),[
    {line:1,reason:'unreadable question-mark words'},
    {line:2,reason:'unreadable question-mark words'},
    {line:3,reason:'unreadable question-mark words'},
    {line:4,reason:'unicode replacement character'},
  ]);
  assert.deepEqual(textIntegrityViolations(`
    // ?? ???? ignored comment
    const a = value ?? other;
    const b = /[?][?] [??]/;
    const c = 'https://example.test/?q=??&next=?';
    const d = 'האם להמשיך?';
    const e = '??';
  `),[]);
});

test('ratchet rejects new long files, added giant lines and larger maxima, while accepting cleanup',()=>{
  const original=measureReadability('x'.repeat(1200)+'\r\n'+ 'y'.repeat(600));
  assert.deepEqual(original,{over500:2,over1000:1,longest:1200});
  assert.ok(readabilityRegressions({'new.js':original},{}).length);
  assert.ok(readabilityRegressions({'old.js':{...original,over500:3}},{'old.js':original}).length);
  assert.ok(readabilityRegressions({'old.js':{...original,longest:1201}},{'old.js':original}).length);
  assert.deepEqual(readabilityRegressions({'old.js':measureReadability('clean\ncode')},{'old.js':original}),[]);
  assert.deepEqual(readabilityRegressions({}, {'removed.js':original}),[]);
});
