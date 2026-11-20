import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createConnectionVault} from '../netunim-kupa/bank-bridge/connection-vault.mjs';
import {normalizeConnectionImportDocument,normalizeStoredCredentials} from '../netunim-kupa/bank-bridge/connection-settings.mjs';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
import {createConnectionCommands} from '../netunim-kupa/bank-bridge/connection-commands.mjs';
import {runPowerShell} from '../netunim-kupa/bank-bridge/windows-platform.mjs';
import {buildBankDpapi} from './bank_dpapi_fixture.mjs';

export function importDocument(){return {schema:'netunim-finance-connections',version:1,mode:'replace',bank:{provider:'hapoalim',userCode:'0012',password:' padded bank secret ',accounts:{business:{branchNumber:'001',accountNumber:'000123'},home:{branchNumber:'002',accountNumber:'000456'}}},credit:{profiles:[{connectionKey:'portable',provider:'max',label:'fixture',credentials:{username:'fixture',password:' padded credit secret '}}]}}}

async function fixture(t,ports={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim bank vault '));
  t.after(async()=>{
    const resolved=path.resolve(directory),base=path.resolve(os.tmpdir())+path.sep;
    assert.ok(resolved.startsWith(base)&&path.basename(resolved).startsWith('netunim bank vault '));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const vault=createConnectionVault({directory,protectText:async text=>Buffer.from(text).toString('base64'),unprotectText:async blob=>Buffer.from(blob,'base64').toString('utf8'),...ports});
  return {directory,vault,bank:path.join(directory,'hapoalim-credentials.dpapi'),credit:path.join(directory,'credit-card-profiles.dpapi')};
}

test('native vault keeps deployed filenames, historical selectors, leading zeros and exact secret strings',async t=>{
  const f=await fixture(t);
  assert.equal(await f.vault.readCredentials(),null);assert.deepEqual(await f.vault.readCreditProfiles(),[]);
  await f.vault.writeCredentials({userCode:'0012',password:' padded secret ',branchNumber:'001',accountNumber:'000123'});
  const bank=await f.vault.readCredentials();assert.equal(bank.password,' padded secret ');assert.equal(bank.businessBranchNumber,'001');assert.equal(bank.businessAccountNumber,'000123');
  const normalized=normalizeConnectionImportDocument(importDocument());await f.vault.replaceConnections(normalized);
  assert.equal((await f.vault.readCreditProfiles())[0].credentials.password,' padded credit secret ');
  assert.ok((await fs.readFile(f.bank,'utf8')).endsWith('\n'));assert.ok(!(await fs.readFile(f.bank,'utf8')).includes('padded bank secret'));
  await f.vault.deleteCredentials();await f.vault.deleteCreditProfiles();assert.equal(await f.vault.readCredentials(),null);assert.deepEqual(await f.vault.readCreditProfiles(),[]);
});

for(const existing of [false,true]){
  test(`partial import write restores ${existing?'the exact prior ciphertext bytes':'absence of the prior bank vault'}`,async t=>{
    const f=await fixture(t);
    if(existing){await f.vault.writeCredentials({userCode:'old',password:'old'});await f.vault.writeCreditProfiles([{profileId:'old'}])}
    const oldBank=existing?await fs.readFile(f.bank):null,oldCredit=existing?await fs.readFile(f.credit):null;
    const original=fs.writeFile;let failed=false;
    fs.writeFile=async(file,...args)=>{
      if(path.resolve(file)===f.credit&&!failed){failed=true;throw Object.assign(new Error('fixture disk failure'),{code:'EIO'})}
      return original(file,...args);
    };
    try{await assert.rejects(f.vault.replaceConnections(normalizeConnectionImportDocument(importDocument())),{code:'EIO'})}
    finally{fs.writeFile=original}
    if(existing){assert.deepEqual(await fs.readFile(f.bank),oldBank);assert.deepEqual(await fs.readFile(f.credit),oldCredit)}
    else{await assert.rejects(fs.access(f.bank),{code:'ENOENT'});await assert.rejects(fs.access(f.credit),{code:'ENOENT'})}
  });
}

test('protection failure occurs before changing either persisted vault',async t=>{
  let calls=0;const f=await fixture(t,{protectText:async text=>{if(++calls===2)throw new Error('fixture DPAPI failure');return Buffer.from(text).toString('base64')}});
  await assert.rejects(f.vault.replaceConnections(normalizeConnectionImportDocument(importDocument())),/DPAPI failure/);
  await assert.rejects(fs.access(f.bank),{code:'ENOENT'});await assert.rejects(fs.access(f.credit),{code:'ENOENT'});
});

test('malformed or undecryptable stored vaults propagate failure instead of silently becoming empty',async t=>{
  const f=await fixture(t,{unprotectText:async()=>{throw new Error('fixture corrupt ciphertext')}});
  await fs.writeFile(f.bank,'invalid');await fs.writeFile(f.credit,'invalid');
  await assert.rejects(f.vault.readCredentials(),/corrupt ciphertext/);await assert.rejects(f.vault.readCreditProfiles(),/corrupt ciphertext/);
});

test('import validation retains placeholder/duplicate/provider/role error codes',()=>{
  const cases=[
    [doc=>{doc.mode='merge'},'INVALID_CONNECTION_IMPORT'],
    [doc=>{doc.bank.provider='other'},'UNSUPPORTED_BANK_PROVIDER'],
    [doc=>{doc.bank.password='__FILL_ME__'},'IMPORT_SECRET_PLACEHOLDER'],
    [doc=>{doc.bank.accounts.home.accountNumber=''},'INCOMPLETE_ACCOUNT_SELECTOR'],
    [doc=>{doc.bank.accounts.home={...doc.bank.accounts.business}},'DUPLICATE_ACCOUNT_ROLE'],
    [doc=>{doc.credit.profiles=[]},'INVALID_CONNECTION_IMPORT_CREDIT'],
    [doc=>{doc.credit.profiles[0].connectionKey=''},'IMPORT_PROFILE_ID_REQUIRED'],
    [doc=>{doc.credit.profiles.push(structuredClone(doc.credit.profiles[0]))},'IMPORT_DUPLICATE_PROFILE_ID'],
    [doc=>{doc.credit.profiles.push({...structuredClone(doc.credit.profiles[0]),connectionKey:'another'})},'CREDIT_DUPLICATE_LOGIN'],
  ];
  for(const [change,code] of cases){const doc=importDocument();change(doc);assert.throws(()=>normalizeConnectionImportDocument(doc),{code})}
  assert.equal(normalizeStoredCredentials({branchNumber:'001',accountNumber:'0009'}).businessAccountNumber,'0009');
});

test('import ownership includes cleanup, and the next edit sees the replaced persisted profiles',async t=>{
  const f=await fixture(t),operations=createBridgeOperationOwner();let release,entered;
  const held=new Promise(resolve=>{release=resolve}),cleaning=new Promise(resolve=>{entered=resolve});
  const artifacts={clearBank:async()=>{},writeBankMeta:async()=>{},clearImported:async()=>{entered();await held;return ['fixture-cleanup-warning']},clearCreditData:async()=>{},creditIdentity:p=>p.profileId,deleteCreditIdentity:async()=>{}};
  const commands=createConnectionCommands({operations,vault:f.vault,artifacts});
  const importing=commands.importConnectionSettings(importDocument());await cleaning;
  const editing=commands.saveCreditProfile({profileId:'later',provider:'max',username:'later',password:'later'});
  try{await assert.rejects(operations.provider(()=>{}),{code:'SCRAPE_BUSY'});assert.equal((await f.vault.readCreditProfiles()).length,1)}
  finally{release()}
  const receipt=await importing;await editing;
  assert.deepEqual(receipt.cleanupWarnings,['fixture-cleanup-warning']);
  assert.ok(!JSON.stringify(receipt).includes('secret'),'the command receipt must contain public projections only');
  assert.equal(receipt.credentials,undefined);
  assert.deepEqual((await f.vault.readCreditProfiles()).map(row=>row.profileId),['import:portable','later']);
});

test('Windows CurrentUser DPAPI round-trips the actual vault without plaintext secrets on disk',{skip:process.platform!=='win32'},async t=>{
  const {directory}=await fixture(t);
  await buildBankDpapi(directory);
  const platform=path.join(directory,'windows-platform.mjs');
  await fs.copyFile(fileURLToPath(new URL('../netunim-kupa/bank-bridge/windows-platform.mjs',import.meta.url)),platform);
  const {protectText,unprotectText}=await import(pathToFileURL(platform).href);
  const f=await fixture(t,{protectText,unprotectText});
  const normalized=normalizeConnectionImportDocument(importDocument());await f.vault.replaceConnections(normalized);
  assert.equal((await f.vault.readCredentials()).password,normalized.credentials.password);
  assert.deepEqual(await f.vault.readCreditProfiles(),normalized.profiles);
  for(const file of [f.bank,f.credit]){const bytes=await fs.readFile(file,'utf8');assert.ok(!bytes.includes('padded'));assert.ok(!bytes.includes('userCode'))}
  // Both directions exercise the previously deployed PowerShell implementation.
  const sample='  synthetic מזוהה 🔐  ';
  const plain64=Buffer.from(sample,'utf8').toString('base64');
  const encrypted=await protectText(sample);
  const oldImplementation=String.raw`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser
$plain=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputData.cipher),$null,$scope)
if([Convert]::ToBase64String($plain) -cne $inputData.plain){throw 'Older DPAPI decoder could not read the new vault format.'}
$cipher=[System.Security.Cryptography.ProtectedData]::Protect($plain,$null,$scope)
[Console]::Out.Write([Convert]::ToBase64String($cipher))`;
  assert.equal(await unprotectText(await runPowerShell(oldImplementation,JSON.stringify({plain:plain64,cipher:encrypted}))),sample);
  await assert.rejects(unprotectText('aW52YWxpZA=='),/Windows credential vault/);
});
