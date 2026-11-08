import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sanitizeBankDiagnosticValue} from '../netunim-kupa/bank-bridge/bank-diagnostics.mjs';
import {createBridgeArtifacts} from '../netunim-kupa/bank-bridge/bridge-artifacts.mjs';

test('structural diagnostics remove named and unknown personal/financial leaves and URLs',()=>{
  const sample={accountNumber:105012322,branchNumber:183,checkNumber:'4463454',beneficiary:{name:'private beneficiary'},
    maskedDecoy:'•••• 1234 private-after-mask',rows:[{unknownValue:'sensitive free text',unknownNumber:7654321}],details:'https://example.org/private-person/123?account=456',
    eventActivityTypeCode:1,hasDetails:true};
  const sanitized=sanitizeBankDiagnosticValue(sample),encoded=JSON.stringify(sanitized);
  for(const value of ['105012322','183','4463454','private beneficiary','sensitive free text','7654321','private-person','456','private-after-mask'])assert.equal(encoded.includes(value),false,value);
  assert.equal(sanitized.eventActivityTypeCode,1);assert.equal(sanitized.hasDetails,true);
  assert.deepEqual(Object.keys(sanitized),Object.keys(sample));
});
test('expired current and legacy bank diagnostics are physically removed, without deleting fresh or unrelated files',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'diagnostic-expiry-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let now=Date.now();const artifacts=createBridgeArtifacts({directory,diagnosticMaxAgeMs:1000,now:()=>now});
  await artifacts.bankDiagnostic.write({schemaVersion:4,structure:true});
  assert.equal((await artifacts.bankDiagnostic.read()).structure,true);
  const diagnostics=path.join(directory,'diagnostics'),legacy=path.join(diagnostics,'bank-cheque-latest.json');
  await fs.writeFile(legacy,'{"historical":true}');await fs.writeFile(path.join(directory,'keep.txt'),'retained');
  now+=2000;
  assert.equal(await artifacts.bankDiagnostic.read(),null);
  for(const file of ['bank-latest.json','bank-cheque-latest.json'])await assert.rejects(fs.access(path.join(diagnostics,file)),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(directory,'keep.txt'),'utf8'),'retained');
});
