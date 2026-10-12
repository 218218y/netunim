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
