import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankOriginPolicy,decodeBankOriginConfiguration} from '../netunim-kupa/bank-bridge/origin-policy.mjs';

test('an absent Bank origin configuration preserves the deployed mode while explicit invalid data fails closed',()=>{
  assert.equal(createBankOriginPolicy().mode,'legacy-reflect');
  assert.equal(createBankOriginPolicy().allows('https://foreign.example'),true);
  for(const value of [null,[],{},true,{version:2,mode:'allowlist'},{version:1,mode:'typo'},
    {version:1,mode:'allowlist',allowedOrigins:null},{version:1,mode:'allowlist',allowedOrigins:'*'},
    {version:1,mode:'allowlist',allowedOrigins:Array(65).fill('https://custom.example')}]){
    assert.throws(()=>createBankOriginPolicy(value),/BANK_ORIGIN_CONFIG_INVALID/);
  }
});

test('custom origins are exact HTTP origins without wildcard/path/credential/query ambiguity',()=>{
  for(const value of ['*','null','file:///tmp','https://*.example.com','https://custom.example/',
    'https://custom.example/path','https://user:secret@custom.example','https://custom.example?token=private',
    'https://custom.example#fragment',' https://custom.example','https://CUSTOM.example',42,{}]){
    assert.throws(()=>createBankOriginPolicy({version:1,mode:'allowlist',allowedOrigins:[value]}),/BANK_ORIGIN_INVALID/);
  }
  assert.deepEqual(decodeBankOriginConfiguration({version:1,mode:'allowlist',allowedOrigins:['https://custom.example','https://custom.example']}),
    {version:1,mode:'allowlist',allowedOrigins:['https://custom.example']});
  const policy=createBankOriginPolicy({version:1,mode:'allowlist'});
  for(const value of [null,[],{},'null','https://bargig-kupa.pages.dev.evil.example'])assert.equal(policy.allows(value),false);
  assert.equal(policy.allows(undefined),true);
  assert.equal(Object.isFrozen(policy),true);
});
