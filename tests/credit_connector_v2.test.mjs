import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CREDIT_CONNECTOR_CONTRACT_VERSION,
  VisaCalAdapter,
  buildCreditMonthPlan,
  classifyCreditHttpResponse,
  parseRetryAfter,
  parseVisaCalFrame,
  parseVisaCalMonthData,
} from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import {launchCamoufox} from '../netunim-kupa/bank-bridge/isracard-camoufox.mjs';
import {creditIdentityDirectory,deleteCreditIdentity} from '../netunim-kupa/bank-bridge/credit-identity.mjs';
import {createCreditDiagnosticLog,responseShapeFingerprint,safeCreditResponseShape,sanitizeCreditDiagnosticEvent} from '../netunim-kupa/bank-bridge/credit-diagnostics.mjs';

assert.equal(CREDIT_CONNECTOR_CONTRACT_VERSION,2);
const fixedNow=new Date('2026-09-03T06:00:00.000Z'),profile={profileId:'cal-profile',provider:'visaCal',label:'כאל בדיקה',credentials:{username:'local-user',password:'never-log-me'}};
const plan=buildCreditMonthPlan({startDate:new Date('2026-05-01T00:00:00Z'),futureMonths:12,now:fixedNow});
assert.equal(plan.at(-1).month,'2027-09','the connector keeps the full +12-month issuer horizon');
assert.equal(plan.find(row=>row.month==='2026-10').tier,'core','the nearest future month is part of required core coverage');
assert.equal(plan.find(row=>row.month==='2026-11').tier,'forecast','later issuer months are forecast enrichment');

function response(body,{status=200,headers={}}={}){return {status,headers:{get:name=>headers[String(name).toLowerCase()]||null},text:async()=>typeof body==='string'?body:JSON.stringify(body)}}
function transaction(card,month){return {trnIntId:`${card}-${month}`,trnTypeCode:'5',trnPurchaseDate:`${month}-02T00:00:00.000Z`,debCrdDate:`${month}-10T00:00:00.000Z`,trnAmt:25,amtBeforeConvAndIndex:25,trnCurrencySymbol:'₪',debCrdCurrencySymbol:'₪',merchantName:'fixture merchant',transTypeCommentDetails:''}}
function calMonth(card,month){return {statusCode:1,result:{bankAccounts:[{debitDates:[{transactions:[transaction(card,month)]}],immidiateDebits:{debitDays:[]}}]}}}
function fakeScraper(overrides={}){const calls={initialize:0,login:0,cards:0,auth:0,terminate:0};return {calls,scraper:{initialize:async()=>{calls.initialize++},login:async()=>{calls.login++;return {success:true}},getCards:async()=>{calls.cards++;return [{cardUniqueId:'card-a',last4Digits:'1111'},{cardUniqueId:'card-b',last4Digits:'2222'}]},getAuthorizationHeader:async()=>{calls.auth++;return 'CALAuthScheme safe-test-token'},getXSiteId:async()=> 'site-id',terminate:async()=>{calls.terminate++},...overrides}}}
function fetchFixture({failureMonth='',failureCard='',failureKind='provider',framesBody=null,pendingBody=null}={}){return async(url,options)=>{const body=JSON.parse(options.body);if(url.includes('/Frames/'))return response(framesBody??{result:{calIssuedCards:{cardLevelFrames:[{cardUniqueId:body.cardsForFrameData[0].cardUniqueId,nextTotalDebit:100,nextDebitDate:'2026-09-10'}],frameLimitForCardAmount:10000}}});if(url.includes('/approvals/'))return response(pendingBody??{statusCode:96});const month=`${body.year}-${String(body.month).padStart(2,'0')}`,card=body.cardUniqueId;if(month===failureMonth&&card===failureCard){if(failureKind==='schema')return response({statusCode:1,result:{changed:true}});if(failureKind==='html')return response('<!doctype html><html>maintenance</html>');return response({statusCode:9,title:'temporary issuer failure'})}return response(calMonth(card,month))}}
function adapterFor(scraper,fetchImpl){return new VisaCalAdapter({profile,CompanyTypes:{visaCal:'visaCal'},createScraper:()=>scraper,browserPath:'browser.exe',fetchImpl,requestDelayMs:0,now:()=>new Date(fixedNow)})}

const forecastFixture=fakeScraper(),forecastResult=await adapterFor(forecastFixture.scraper,fetchFixture({failureMonth:'2026-11',failureCard:'card-a'})).scrape();
assert.equal(forecastFixture.calls.login,1,'all Cal cards and months share exactly one login');
assert.equal(forecastFixture.calls.initialize,1);assert.equal(forecastFixture.calls.terminate,1);
assert.equal(forecastResult.coreComplete,true,'one later forecast failure does not fail required profile coverage');
assert.equal(forecastResult.accounts.find(account=>account.accountNumber==='1111').months.find(row=>row.month==='2026-11').fetchStatus,'provider_error');
assert.equal(forecastResult.accounts.find(account=>account.accountNumber==='2222').months.find(row=>row.month==='2026-11').fetchStatus,'success','one card failure cannot discard another card');
assert(forecastResult.errors.some(error=>error.code==='CREDIT_PARTIAL_FORECAST'));

const schemaFixture=fakeScraper(),schemaResult=await adapterFor(schemaFixture.scraper,fetchFixture({failureMonth:'2026-10',failureCard:'card-a',failureKind:'schema'})).scrape();
assert.equal(schemaResult.coreComplete,false,'a schema change in the nearest future/core month prevents a full-success timestamp');
assert.equal(schemaResult.accounts[0].months.find(row=>row.month==='2026-10').fetchStatus,'schema_error');
assert(schemaResult.errors.some(error=>error.code==='CREDIT_CORE_COVERAGE_INCOMPLETE'));

const htmlFailure=classifyCreditHttpResponse({status:200,text:'<!DOCTYPE html><html>challenge</html>',stage:'Transactions 2026-11'});
assert.equal(htmlFailure.code,'CREDIT_PROVIDER_RESPONSE_NOT_JSON');
assert.equal(htmlFailure.message.includes('<html>'),false,'raw issuer HTML never enters a public error');
const blockedFailure=classifyCreditHttpResponse({status:403,text:'forbidden body must stay private',stage:'Frames'});
assert.equal(blockedFailure.code,'CREDIT_AUTOMATION_BLOCKED','403 is a durable automation block, not a generic HTTP error');
assert.equal(blockedFailure.message.includes('forbidden body'),false,'the 403 response body never enters a public error');
assert.throws(()=>parseVisaCalMonthData({statusCode:1,result:{newSchema:true}}),error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR');
assert.throws(()=>parseVisaCalMonthData({statusCode:17,title:'failed month'}),error=>error.code==='CREDIT_PROVIDER_DATA_ERROR');

const missingFrames=parseVisaCalFrame({}, {cardUniqueId:'card-a'}),nullFrames=parseVisaCalFrame({result:null},{cardUniqueId:'card-a'});
assert.equal(missingFrames.frameStatus,'missing','Frames without result is optional/unavailable under the official 6.9.0 contract');
assert.equal(nullFrames.frameStatus,'missing','Frames result:null is treated as unavailable rather than an invented schema change');
assert.equal(missingFrames.warning.code,'CREDIT_FRAMES_UNAVAILABLE');
assert.throws(()=>parseVisaCalFrame({statusCode:17,title:'issuer rejected'},{cardUniqueId:'card-a'}),error=>error.code==='CREDIT_PROVIDER_DATA_ERROR'&&error.stage==='Frames');
const bankOnly=parseVisaCalFrame({result:{bankIssuedCards:{cardLevelFrames:[{cardUniqueId:'card-a',nextTotalDebit:125,nextDebitDate:'2026-09-15'}],frameLimitForCardAmount:7000}}},{cardUniqueId:'card-a'});
assert.deepEqual({balance:bankOnly.balance,cardFrame:bankOnly.cardFrame,cardType:bankOnly.cardType},{balance:-125,cardFrame:7000,cardType:'bankIssued'});
const calOnly=parseVisaCalFrame({result:{calIssuedCards:{cardLevelFrames:[{cardUniqueId:'card-a',nextTotalDebit:90}],frameLimitForCardAmount:6000}}},{cardUniqueId:'card-a'});
assert.deepEqual({balance:calOnly.balance,cardFrame:calOnly.cardFrame,cardType:calOnly.cardType},{balance:-90,cardFrame:6000,cardType:'companyIssued'});
const accountFallback=parseVisaCalFrame({result:{bankIssuedCards:{cardLevelFrames:[{cardUniqueId:'different-card'}],nextTotalDebitForAccount:310,nextTotalDebitDateForAccount:'2026-09-20',frameLimitForCardAmount:8000}}},{cardUniqueId:'card-a'});
assert.deepEqual({balance:accountFallback.balance,balanceDate:accountFallback.balanceDate,cardFrame:accountFallback.cardFrame},{balance:-310,balanceDate:'2026-09-20T00:00:00.000Z',cardFrame:8000},'a sole matching account group supplies the official account-level fallback when no card frame matches');
assert.throws(()=>parseVisaCalFrame({result:{bankIssuedCards:'impossible-group'}},{cardUniqueId:'card-a'}),error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR'&&error.stage==='Frames');

const framesWarningFixture=fakeScraper(),framesWarningResult=await adapterFor(framesWarningFixture.scraper,fetchFixture({framesBody:{}})).scrape();
assert.equal(framesWarningResult.coreComplete,true,'Frames unavailable never changes Core transaction coverage');
assert.equal(framesWarningResult.accounts[0].frameStatus,'missing');
assert(framesWarningResult.errors.some(error=>error.component==='frames'&&error.severity==='warning'&&error.code==='CREDIT_FRAMES_UNAVAILABLE'));
assert.equal(framesWarningResult.errors.some(error=>error.severity==='error'),false,'successful Core plus a Frames warning contains no profile error');
const pendingWarningFixture=fakeScraper(),pendingWarningResult=await adapterFor(pendingWarningFixture.scraper,fetchFixture({pendingBody:{statusCode:17,title:'pending unavailable'}})).scrape();
assert.equal(pendingWarningResult.coreComplete,true,'Pending is a warning component and never changes Core transaction coverage');assert(pendingWarningResult.errors.some(error=>error.component==='pending'&&error.severity==='warning'));

let rateLimitedCalls=0;const rateLimitedFixture=fakeScraper(),rateLimitedResult=await adapterFor(rateLimitedFixture.scraper,async()=>{rateLimitedCalls++;return response('',{status:429,headers:{'retry-after':'7200'}})}).scrape();
assert.equal(rateLimitedCalls,1,'after the first 429 the current Cal session performs no additional Frames, Pending or monthly HTTP calls');
assert.equal(rateLimitedResult.coreComplete,false);assert(rateLimitedResult.errors.some(error=>error.severity==='deferred'&&error.component==='core_transactions'));

const shape=safeCreditResponseShape({statusCode:1,title:'secret title',authorization:'Bearer secret-token',result:{bankIssuedCards:{nextTotalDebitForAccount:987654,cardLevelFrames:[{cardUniqueId:'full-sensitive-card-id',nextTotalDebit:123456}]}}}),shapeSerialized=JSON.stringify(shape),shapeHash=responseShapeFingerprint(shape);
assert.deepEqual(shape.topLevelKeys,['authorization','result','statusCode','title']);
assert.equal(shape.bankIssuedCards.cardLevelFrames.count,1);assert.equal(shape.bankIssuedCards.cardLevelFrames.type,'array');
for(const secret of ['Bearer secret-token','full-sensitive-card-id','987654','123456'])assert.equal(shapeSerialized.includes(secret),false,`safe response shape excludes response value ${secret}`);
assert.equal(shapeHash.length,24);assert.equal(shapeHash,responseShapeFingerprint(safeCreditResponseShape({statusCode:2,title:'different values',authorization:'changed',result:{bankIssuedCards:{nextTotalDebitForAccount:1,cardLevelFrames:[{cardUniqueId:'other'}]}}})),'shape fingerprints depend only on structure/presence, never response values');

const initFixture=fakeScraper({getCards:async()=>{throw new Error('init missing')}});
await assert.rejects(()=>adapterFor(initFixture.scraper,fetchFixture()).scrape(),error=>error.code==='CREDIT_SESSION_INIT_MISSING');
const authFixture=fakeScraper({getAuthorizationHeader:async()=>{throw new Error('auth missing')}});
await assert.rejects(()=>adapterFor(authFixture.scraper,fetchFixture()).scrape(),error=>error.code==='CREDIT_AUTH_TOKEN_MISSING');
const loginFixture=fakeScraper({login:async()=>{throw new Error('failed to extract login iframe #regular-login')}});
await assert.rejects(()=>adapterFor(loginFixture.scraper,fetchFixture()).scrape(),error=>error.code==='CREDIT_LOGIN_UI_UNAVAILABLE');

const retryBase=Date.parse('2026-09-03T06:00:00.000Z');
assert.equal(parseRetryAfter('7200',retryBase),'2026-09-03T08:00:00.000Z');
assert.equal(classifyCreditHttpResponse({status:429,text:'',stage:'Pending',retryAfter:'7200',now:retryBase}).retryAfterAt,'2026-09-03T08:00:00.000Z','Retry-After controls the next eligible attempt');

const diagnostic=sanitizeCreditDiagnosticEvent({provider:'amex',profileId:'p',stage:'LoginPage',httpStatus:403,responseShape:shape,username:'secret-user',password:'secret-password',rawHtml:'<html>secret</html>',authorization:'Bearer secret'}),serializedDiagnostic=JSON.stringify(diagnostic);
assert.equal(serializedDiagnostic.includes('secret'),false,'diagnostics use an allowlist and cannot retain credentials, tokens or raw HTML');
assert.equal(diagnostic.httpStatus,403);assert.equal(diagnostic.fingerprint.length,16);
assert.equal(diagnostic.responseShapeFingerprint,shapeHash);assert.equal(serializedDiagnostic.includes('full-sensitive-card-id'),false);

const identityRoot=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-credit-v2-'));
try{
  const identityDir=creditIdentityDirectory(path.join(identityRoot,'credit-identities'),{provider:'amex',credentials:{id:'123456789'}}),otherDir=creditIdentityDirectory(path.join(identityRoot,'credit-identities'),{provider:'amex',credentials:{id:'987654321'}}),launches=[];
  const fakeCamoufox=async options=>{launches.push(structuredClone(options));if(!options.config['navigator.userAgent'])options.config['navigator.userAgent']='stable-firefox';if(!options.config['canvas:seed'])options.config['canvas:seed']=12345;return {close:async()=>{}}};
  await launchCamoufox(fakeCamoufox,{identityDir,enableCache:true});await launchCamoufox(fakeCamoufox,{identityDir,enableCache:true});
  assert.equal(launches.length,2);assert.equal(launches[0].user_data_dir,launches[1].user_data_dir,'two launches reuse the same persistent BrowserContext directory');
  assert.equal(launches[1].config['navigator.userAgent'],'stable-firefox');assert.equal(launches[1].config['canvas:seed'],12345,'the generated identity config and anti-fingerprinting seed survive a restart');
  await fs.mkdir(otherDir,{recursive:true});await fs.writeFile(path.join(otherDir,'keep.txt'),'keep');
  await deleteCreditIdentity(path.join(identityRoot,'credit-identities'),{provider:'amex',credentials:{id:'123456789'}});
  await assert.rejects(()=>fs.stat(identityDir),error=>error.code==='ENOENT');assert.equal((await fs.readFile(path.join(otherDir,'keep.txt'),'utf8')),'keep','deleting one connection removes only its browser identity');
  const diagnosticLog=createCreditDiagnosticLog({directory:path.join(identityRoot,'diagnostics'),maxBytes:64,fileCount:2,retentionMs:100});
  await diagnosticLog.record({provider:'amex',stage:'old'});await fs.utimes(diagnosticLog.logPath,new Date(0),new Date(0));await diagnosticLog.record({provider:'max',stage:'new'});
  assert.deepEqual((await diagnosticLog.summary()).map(event=>event.provider),['max'],'expired diagnostics are pruned before a new event can revive an old log file');
  await diagnosticLog.record({provider:'visaCal',stage:'rotate'});assert.equal((await diagnosticLog.summary()).length,2,'diagnostic rotation stays within its configured file count');
}finally{await fs.rm(identityRoot,{recursive:true,force:true})}

console.log('PASS Credit Connector v2: monthly Cal isolation, core/forecast coverage, persistent identity, Retry-After and safe diagnostics are deterministic');
