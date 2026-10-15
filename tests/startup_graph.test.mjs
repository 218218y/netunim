import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditStartup} from '../tools/startup-graph.mjs';

test('native graph distinguishes static, dynamic, shared and worker closures',()=>{
  const site=fs.mkdtempSync(path.join(os.tmpdir(),'startup-graph-'));
  const write=(name,source)=>fs.writeFileSync(path.join(site,'assets',name),source);
  try{
    fs.mkdirSync(path.join(site,'assets'));
    write('app.js',"import './main.js';");
    write('main.js',"import './domain.js';import './shared.js';export const load=()=>import('./lazy.js');new Worker(new URL('./worker.js',import.meta.url));");
    write('domain.js',"export {value} from './shared.js';");
    write('shared.js','export const value=1;\r\n');
    write('lazy.js',"import './shared.js';");write('worker.js','export const worker=true;');
    const report=auditStartup(site);
    assert.equal(report.startup.modules,4);assert.equal(report.reachable.modules,6);
    const domain=report.candidates.find(row=>row.to==='assets/domain.js');
    assert.equal(domain.modules,1,'shared static dependency remains eager');
    assert.equal(domain.sourceBytes,Buffer.byteLength("export {value} from './shared.js';"));
    assert.equal(report.candidates.some(row=>row.to==='assets/shared.js'),false);
    write('lazy.js',"import '../../escape.js';");
    assert.throws(()=>auditStartup(site),/Cross-site/);
    write('lazy.js','export const load=x=>import(x);');
    assert.throws(()=>auditStartup(site),/computed dependency/);
  }finally{fs.rmSync(site,{recursive:true,force:true})}
});

const budgets=JSON.parse(fs.readFileSync(new URL('./fixtures/startup-budgets.json',import.meta.url)));
for(const app of ['kupa','orders'])test(`${app}: eager native ESM source and module budgets`,()=>{
  const report=auditStartup(`netunim-${app}/site`),budget=budgets.graph[app];
  assert.ok(report.startup.modules<=budget.modules,JSON.stringify(report.startup));
  assert.ok(report.startup.sourceBytes<=budget.sourceBytes,JSON.stringify(report.startup));
});
