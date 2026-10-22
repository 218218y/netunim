// Lightweight diagnostic for the changed algorithm, using synthetic text only.
// Run: node tools/benchmark-document-search.mjs > .work/document-search-benchmark.json
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createDocumentTextMatcher} from '../shared/document-text-search.js';

const samples=5,rows=[];
for(const tokens of [1000,10000,100000]){
  const repeated='אב '.repeat(tokens);
  const cases=[
    {name:'proximity-missing-suffix',query:'אב אב אב אב אב אין',mode:'proximity',text:repeated,expected:false},
    {name:'proximity-repeated-valid',query:'אב אב אב אב אב אב',mode:'proximity',text:repeated,expected:true},
    {name:'all-missing-after-cap',query:'אב אין',mode:'all',text:repeated,expected:false},
    {name:'all-late-term-after-cap',query:'אב אין',mode:'all',text:repeated+'אין',expected:true},
  ];
  for(const scenario of cases){
    const times=[];
    for(let i=0;i<samples;i++){
      const start=performance.now();
      const result=createDocumentTextMatcher(scenario.query,{matchMode:scenario.mode,proximityWords:50})
        .find(scenario.text,{maxMatches:1});
      times.push(performance.now()-start);
      assert.equal(result.matches.length>0,scenario.expected,scenario.name);
      if(scenario.expected&&scenario.mode==='all')assert.equal(result.foundTerms.length,2);
    }
    const ordered=[...times].sort((a,b)=>a-b);
    rows.push({scenario:scenario.name,tokens,utf16Length:scenario.text.length,samplesMs:times,
      medianMs:ordered[Math.floor(samples/2)],p95Ms:ordered[Math.ceil(samples*.95)-1]});
  }
}
const root=new URL('../',import.meta.url),source=readFileSync(new URL('../shared/document-text-search.js',import.meta.url));
const report={schemaVersion:1,capturedAt:new Date().toISOString(),
  sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  workingTreeDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  sourceSha256:createHash('sha256').update(source).digest('hex'),
  environment:{node:process.version,os:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model},
  scope:'synthetic matcher compute only; excludes UI, disk, cloud and native Everything',samples,rows};
console.log(JSON.stringify(report,null,2));
