import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

for (const app of ['orders','kupa']) test(`${app}: release-bound requests never accept another release during cold installation`, async () => {
  const source=readFileSync(new URL(`../netunim-${app}/site/service-worker.js`,import.meta.url),'utf8');
  const release=source.match(/const CACHE='([^']+)'/)[1],handlers={},requests=[],puts=[];
  let skips=0;
  const context={URL,Promise,Error,console,
    self:{location:{origin:'https://fixture.test',href:'https://fixture.test/service-worker.js'},
      addEventListener:(name,handler)=>{handlers[name]=handler},skipWaiting:async()=>{skips++}},
    caches:{open:async()=>({put:async key=>{puts.push(key)}})},
    fetch:async (url,options)=>{
      requests.push({url,options});return {ok:true,headers:{get:()=>'unexpected-future-release'}};
    },
  };
  vm.runInNewContext(source,context);
  const work=[];handlers.install({waitUntil:value=>work.push(value)});
  await assert.rejects(Promise.all(work),/shell_release_mismatch/);
  assert.equal(skips,0);assert.equal(puts.length,0);assert.ok(requests.length>0);
  assert.ok(requests.every(({url,options})=>new URL(url).searchParams.get('__netunim_release')===release&&options.cache==='reload'));
});
