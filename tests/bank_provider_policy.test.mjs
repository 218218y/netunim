import {restoreBankProviderMoneyBoundary} from './bank_balance_policy_fixture.mjs';
import {restoreCreditCooldown} from './credit_cooldown_policy_fixture.mjs';
// Historical policy digests stay immutable. Canonicalization maps only explicit
// platform transports to their former calls; algorithm/branch changes still fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {providerPolicyHashes} from './bank_provider_policy_fixture.mjs';
const read=name=>{const source=restoreCreditCooldown(fs.readFileSync(new URL('../netunim-kupa/bank-bridge/'+name+'.mjs',import.meta.url),'utf8'));return name==='hapoalim-accounts'?restoreBankProviderMoneyBoundary(source):source};
const sources=()=>['server','finance-commands','provider-errors','hapoalim-session','hapoalim-provider','credit-session','credit-provider','hapoalim-json','hapoalim-enrichment','hapoalim-accounts','cheque-images','browser-locator','windows-browser'].map(read);

for(const [name,file] of [['Bank and credit provider policies','bank-provider-policy.json'],['Bank session and error policies','bank-session-policy.json'],['Bank read, image and installed-browser policies','bank-read-policy.json']])test(name+' match their reviewed pre-refactor AST fixtures',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8'));
  if(file==='bank-read-policy.json'){
    // Reviewed audit change: retain validated windows on later failure and
    // require reported capacity. Other provider policies stay immutable.
    assert.equal(fixture.policies.fetchHapoalimAccountSnapshot,'7adfc1e5b8f5082e640270ed1c7756b5ec3de163eec3acba76cf8a154058d263');
    fixture.policies.fetchHapoalimAccountSnapshot='71a805331b89adb67b7bf027186070c880de3c71d2497d2e11631b9e1ef2ec08';
  }
  assert.deepEqual(providerPolicyHashes(sources(),Object.keys(fixture.policies)),fixture.policies);
});

test('transport normalization cannot mask changed image retention or installed-browser priority',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/bank-read-policy.json',import.meta.url),'utf8'));
  for(const [module,before,after,name] of [['cheque-images',/age\s*<\s*CHEQUE_IMAGE_RETENTION_DAYS/,'age<=CHEQUE_IMAGE_RETENTION_DAYS','chequeImageInRetention'],['browser-locator',"['chrome.exe', 'msedge.exe']","['msedge.exe','chrome.exe']",'findInstalledBrowser']]){
    const all=sources(),original=read(module),changed=original.replace(before,after);assert.notEqual(changed,original);
    all[all.indexOf(original)]=changed;assert.notEqual(providerPolicyHashes(all,[name])[name],fixture.policies[name]);
  }
});

test('transport normalization cannot mask a changed provider cleanup or fallback policy',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/bank-provider-policy.json',import.meta.url),'utf8'));
  for(const [module,before,after,name] of [['hapoalim-provider','scraper.terminate(success)','scraper.terminate(false)','scrapeHapoalimSnapshot'],['credit-provider',/allowCamoufoxFallback:\s*!camoufoxDeferred/,'allowCamoufoxFallback:true','scrapeAllCreditProfiles']]){
    const all=sources(),original=read(module),changed=original.replace(before,after);assert.notEqual(changed,original);
    all[all.indexOf(original)]=changed;assert.notEqual(providerPolicyHashes(all,[name])[name],fixture.policies[name]);
  }
});
