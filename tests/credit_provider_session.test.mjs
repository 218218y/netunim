import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditProfileSession} from '../netunim-kupa/bank-bridge/credit-session.mjs';
import {creditProfile,gate} from './bank_provider_fixture.mjs';

test('credit session construction is inert and connector inputs preserve profile identity and flags',async()=>{
  const calls=[],profile=creditProfile('P','amex'),result={profileId:'P',accounts:[]};let options;
  const session=createCreditProfileSession({browser:{findInstalled:async()=>{calls.push('locate');return 'browser'},loadScrapers:async()=>{calls.push('load');return {CompanyTypes:{amex:'amex'},createScraper:'opaque-upstream-factory'}},identityProbeUrl:'http://127.0.0.1:8765/health'},
    identity:{directory:value=>{calls.push('identity');assert.equal(value,profile);return 'scoped-P'}},diagnostics:{record:event=>{calls.push(['diagnostic',event])}},
    createAdapter:value=>{calls.push('adapter');options=value;return {scrape:async()=>{calls.push('scrape');return result}}}});
  assert.deepEqual(calls,[]);assert.equal(await session.scrape(profile,{interactive:true,correlationId:'C',syncMode:'recovery',excludedAccountNumbers:['0007'],allowCamoufoxFallback:false}),result);
  assert.deepEqual(calls,['locate','load','identity','adapter','scrape']);assert.equal(options.profile,profile);assert.equal(options.identityDir,'scoped-P');assert.equal(options.allowCamoufoxFallback,false);assert.equal(options.interactive,true);assert.equal(options.syncMode,'recovery');assert.deepEqual(options.excludedAccountNumbers,['0007']);
  options.onDiagnostic({stage:'fixture',browserEngine:'camoufox'});assert.deepEqual(calls.at(-1),['diagnostic',{browserEngine:'camoufox',stage:'fixture'}]);
});

test('credit browser/library failures cannot create a connector or read an identity directory',async()=>{
  for(const failing of ['locate','load']){
    const error=new Error('fixture '+failing);let connectors=0,identities=0;
    const session=createCreditProfileSession({browser:{findInstalled:async()=>{if(failing==='locate')throw error;return 'browser'},loadScrapers:async()=>{throw error},identityProbeUrl:'fixture'},
      identity:{directory:()=>{identities++;return 'fixture'}},createAdapter:()=>{connectors++;return {scrape:async()=>({})}},diagnostics:{record:()=>{}}});
    await assert.rejects(session.scrape(creditProfile('P')),value=>value===error);assert.equal(connectors,0);assert.equal(identities,0);
  }
});

test('credit session retains the connector promise through final cleanup and propagates its original failure',async()=>{
  const held=gate(),entered=gate(),error=Object.assign(new Error('fixture connector'),{code:'CREDIT_FIXTURE'});
  const session=createCreditProfileSession({browser:{findInstalled:async()=> 'browser',loadScrapers:async()=>({CompanyTypes:{},createScraper:()=>{}}),identityProbeUrl:'fixture'},
    identity:{directory:()=> 'fixture'},createAdapter:()=>({scrape:async()=>{entered.resolve();await held.promise;throw error}}),diagnostics:{record:()=>{}}});
  let done=false;const result=session.scrape(creditProfile('P')).finally(()=>{done=true});const rejected=assert.rejects(result,value=>value===error);
  await entered.promise;assert.equal(done,false);held.resolve();await rejected;assert.equal(done,true);
});
