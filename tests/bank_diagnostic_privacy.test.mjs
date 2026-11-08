import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sanitizeBankDiagnosticValue,createBankDiagnosticRun,recordBankTransactionDiagnostic,finishBankDiagnosticRun} from '../netunim-kupa/bank-bridge/bank-diagnostics.mjs';
import {createBridgeArtifacts} from '../netunim-kupa/bank-bridge/bridge-artifacts.mjs';
import {bankStage} from './bank_stage_fixture.mjs';

test('structural diagnostics remove named and unknown personal/financial leaves and URLs',()=>{
  const sample={accountNumber:105012322,branchNumber:183,checkNumber:'4463454',beneficiary:{name:'private beneficiary'},
    maskedDecoy:'•••• 1234 private-after-mask',rows:[{unknownValue:'sensitive free text',unknownNumber:7654321}],details:'https://example.org/private-person/123?account=456',
    eventActivityTypeCode:1,hasDetails:true};
  const sanitized=sanitizeBankDiagnosticValue(sample),encoded=JSON.stringify(sanitized);
  for(const value of ['105012322','183','4463454','private beneficiary','sensitive free text','7654321','private-person','456','private-after-mask'])assert.equal(encoded.includes(value),false,value);
  assert.equal(sanitized.eventActivityTypeCode,1);assert.equal(sanitized.hasDetails,true);
  assert.equal(Object.keys(sanitized).length,Object.keys(sample).length);
  assert.equal(Object.hasOwn(sanitized,'maskedDecoy'),false,'unreviewed field labels are structural placeholders');
});

test('dynamic dictionary keys and unexpected diagnostic labels cannot export personal information',()=>{
  const run=createBankDiagnosticRun();
  const keyed=JSON.parse('{"105012322":{"private beneficiary":{"checkNumber":"4463454"}},"משה כהן":{"branchNumber":183},"__proto__":{"polluted":true},"referenceNumber":123456789}');
  recordBankTransactionDiagnostic(run,{role:'business',chequeKind:'private cheque holder',transaction:keyed,
    normalizedTransaction:{checkDetails:keyed},detailSources:[{source:'private beneficiary',response:keyed}],mergedAdditionalDetails:keyed});
  const encoded=JSON.stringify(finishBankDiagnosticRun(run));
  for(const value of ['105012322','private beneficiary','4463454','משה כהן','183','private cheque holder','123456789','__proto__','polluted'])assert.equal(encoded.includes(value),false,value);
  assert.equal({}.polluted,undefined);
  assert.equal(run.accounts.business.fieldInventory.rawTransactionFields.includes('referenceNumber'),true);
});

for(const schemaVersion of [4,5])test(`native startup ${schemaVersion===4?'purges pre-hardening':'retains current structural'} diagnostics`,async t=>{
  const f=await bankStage(t,{prepare:async({app})=>{
    const directory=path.join(app,'diagnostics');await fs.mkdir(directory);
    await fs.writeFile(path.join(directory,'bank-latest.json'),JSON.stringify({schemaVersion,structure:true}));
  }});
  const file=path.join(f.app,'diagnostics','bank-latest.json');
  if(schemaVersion===4)await assert.rejects(fs.access(file),{code:'ENOENT'});
  else assert.equal(JSON.parse(await fs.readFile(file,'utf8')).structure,true);
});
test('expired current and legacy bank diagnostics are physically removed, without deleting fresh or unrelated files',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'diagnostic-expiry-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let now=Date.now();const artifacts=createBridgeArtifacts({directory,diagnosticMaxAgeMs:1000,now:()=>now});
  await artifacts.bankDiagnostic.write({schemaVersion:5,structure:true});
  assert.equal((await artifacts.bankDiagnostic.read()).structure,true);
  const diagnostics=path.join(directory,'diagnostics'),legacy=path.join(diagnostics,'bank-cheque-latest.json');
  await fs.writeFile(legacy,'{"historical":true}');await fs.writeFile(path.join(directory,'keep.txt'),'retained');
  now+=2000;
  assert.equal(await artifacts.bankDiagnostic.read(),null);
  for(const file of ['bank-latest.json','bank-cheque-latest.json'])await assert.rejects(fs.access(path.join(diagnostics,file)),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(directory,'keep.txt'),'utf8'),'retained');
});
