import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCreditDiagnosticLog} from '../netunim-kupa/bank-bridge/credit-diagnostics.mjs';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

test('diagnostic drainage retains native append jobs and trailing records until their exact bytes exist',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim diagnostic drain '));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('netunim diagnostic drain '));await fs.rm(directory,{recursive:true,force:true})});
  const held=gate(),entered=gate(),last=gate(),lastEntered=gate(),original=fs.appendFile;let calls=0;
  fs.appendFile=async(...args)=>{if(++calls===1){entered.resolve();await held.promise}else{lastEntered.resolve();await last.promise}return original(...args)};
  const logger=createCreditDiagnosticLog({directory,bridgeVersion:73});
  const first=logger.record({profileId:'first',stage:'Fixture'});await entered.promise;
  let done=false;const drain=logger.drain().then(()=>{done=true});const second=logger.record({profileId:'second',stage:'Fixture'});
  try{held.resolve();await first;await lastEntered.promise;assert.equal(done,false,'a trailing diagnostic must remain owned after the first queue snapshot settles')}
  finally{held.resolve();last.resolve();await Promise.all([first,second,drain]);fs.appendFile=original}
  const records=(await fs.readFile(logger.logPath,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(records.map(row=>row.profileId),['first','second']);
});

test('diagnostic drainage retains an accepted native summary read',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim diagnostic drain '));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('netunim diagnostic drain '));await fs.rm(directory,{recursive:true,force:true})});
  const logger=createCreditDiagnosticLog({directory,bridgeVersion:73});await logger.record({profileId:'retained',stage:'Fixture'});
  const entered=gate(),held=gate(),original=fs.readFile;
  fs.readFile=async(...args)=>{if(String(args[0]).endsWith('credit-diagnostics.jsonl')){entered.resolve();await held.promise}return original(...args)};
  const summary=logger.summary();await entered.promise;let drained=false;const draining=logger.drain().then(()=>{drained=true});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false,'accepted log reads must be joined before shutdown')}
  finally{held.resolve();await Promise.allSettled([summary,draining]);fs.readFile=original}
  assert.equal((await summary)[0].profileId,'retained');
});

test('a held log summary owns its file snapshot before a later record can rotate it',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim diagnostic drain '));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('netunim diagnostic drain '));await fs.rm(directory,{recursive:true,force:true})});
  const logger=createCreditDiagnosticLog({directory,bridgeVersion:73,maxBytes:1,fileCount:2});await logger.record({profileId:'first',stage:'Fixture',timestamp:'2026-10-13T00:00:00Z'});
  const entered=gate(),held=gate(),read=fs.readFile,rename=fs.rename;let rotations=0;
  fs.readFile=async(...args)=>{if(String(args[0]).endsWith('credit-diagnostics.jsonl')){entered.resolve();await held.promise}return read(...args)};
  fs.rename=async(...args)=>{rotations++;return rename(...args)};
  const summary=logger.summary();await entered.promise;const second=logger.record({profileId:'second',stage:'Fixture',timestamp:'2026-10-13T01:00:00Z'});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(rotations,0,'rotation must not move an accepted reader\'s current file')}
  finally{held.resolve();await Promise.allSettled([summary,second]);fs.readFile=read;fs.rename=rename}
  assert.deepEqual((await summary).map(value=>value.profileId),['first']);assert.deepEqual((await logger.summary()).map(value=>value.profileId),['second','first']);assert.equal(rotations,1);
});

test('an accepted log summary retains its original limit while waiting behind an earlier read',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim diagnostic drain '));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('netunim diagnostic drain '));await fs.rm(directory,{recursive:true,force:true})});
  const logger=createCreditDiagnosticLog({directory,bridgeVersion:73});await logger.record({profileId:'first',timestamp:'2026-10-13T00:00:00Z'});await logger.record({profileId:'second',timestamp:'2026-10-13T01:00:00Z'});
  const invalid=logger.summary(null);assert.ok(invalid instanceof Promise);await assert.rejects(invalid,TypeError);
  const entered=gate(),held=gate(),original=fs.readFile;
  fs.readFile=async(...args)=>{if(String(args[0]).endsWith('credit-diagnostics.jsonl')){entered.resolve();await held.promise}return original(...args)};
  const first=logger.summary();await entered.promise;const options={limit:1},limited=logger.summary(options);options.limit=2;
  try{held.resolve();assert.equal((await limited).length,1,'read options must retain their acceptance-time value')}
  finally{held.resolve();await Promise.allSettled([first,limited]);fs.readFile=original}
});
