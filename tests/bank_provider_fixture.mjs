import * as policy from '../netunim-kupa/bank-bridge/lib.mjs';
import * as bankDiagnostics from '../netunim-kupa/bank-bridge/bank-diagnostics.mjs';
import {createHapoalimProvider} from '../netunim-kupa/bank-bridge/hapoalim-provider.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {createHapoalimSessionAdapter} from '../netunim-kupa/bank-bridge/hapoalim-session.mjs';

export const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
export const credentials={userCode:'0012',password:' exact synthetic secret '};

export function bankProviderFixture(overrides={}){
  const calls=[],ready={ready:true,href:'https://login.bankhapoalim.co.il/dashboard',restContext:'fixture'},page={fixture:true};
  const scraper={page,initialize:async()=>{calls.push(['initialize'])},login:async input=>{calls.push(['login',input]);return {success:true}},terminate:async success=>{calls.push(['terminate',success])},...overrides.scraper};
  const browser={findInstalled:async()=>{calls.push(['locate']);return 'fixture-browser'},ensureProfile:async()=>{calls.push(['profile'])},profileDirectory:'fixture-profile',
    loadScrapers:async()=>{calls.push(['load']);return {CompanyTypes:{hapoalim:'hapoalim'},createScraper:options=>{calls.push(['create',options]);return scraper}}},...overrides.browser};
  const session={decorate:(value,options)=>{calls.push(['decorate',options]);return value},reuse:async()=>{calls.push(['reuse']);return ready},
    ready:async()=>{calls.push(['ready']);return ready},...overrides.session};
  const accounts={lookbackDays:policy.HAPOALIM_TRANSACTION_LOOKBACK_DAYS,read:async(p,input,state,days,{diagnosticRun})=>{
    calls.push(['read',input,state,days]);diagnosticRun.accounts.business.captured=1;
    return {balance:42,accounts:{business:{balance:42},home:null},accountFailures:{home:null},sessionHref:ready.href};
  },...overrides.accounts};
  const diagnostics={create:bankDiagnostics.createBankDiagnosticRun,finish:bankDiagnostics.finishBankDiagnosticRun,write:async run=>{calls.push(['diagnostic',run])},
    report:(...args)=>calls.push(['report',...args]),...overrides.diagnostics};
  const cache={cleanup:async()=>{calls.push(['cache'])},...overrides.cache},metadata={write:async value=>{calls.push(['remember',value])},...overrides.metadata};
  const adapter=createHapoalimSessionAdapter({metadata:{read:async()=>({})},clock:{now:()=>Date.now(),delay:async()=>{}},waitForTerminal:async()=>({resultKey:'SUCCESS'})});
  const read=createHapoalimProvider({browser,session:{...session,safeUrl:adapter.safeUrl,failureMessage:policy.scraperFailureMessage},accounts,diagnostics,cache,metadata,version:73}).read;
  return {read,calls,ready,page,scraper,browser,session,accounts,diagnostics,cache,metadata};
}

export const creditProfile=(profileId,provider='max')=>({profileId,provider,label:profileId,active:true,credentials:{username:profileId,password:' exact synthetic credit secret '}});
export function creditProviderFixture(overrides={}){
  const calls=[],sessions={scrape:async(profile,options)=>{calls.push(['scrape',profile.profileId,options]);return {profileId:profile.profileId,provider:profile.provider,coreComplete:true,accounts:[]}},...overrides.sessions};
  const identity={remove:async profile=>{calls.push(['identity',profile.profileId])},...overrides.identity},diagnostics={record:async event=>{calls.push(['diagnostic',event])},...overrides.diagnostics};
  const scrape=createCreditProvider({sessions,identity,diagnostics}).scrape;
  return {scrape,calls,sessions,identity,diagnostics};
}
