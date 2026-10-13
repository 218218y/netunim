import {createBridgeArtifacts} from './bridge-artifacts.mjs';
import { createHapoalimJsonReader } from './hapoalim-json.mjs';
import { createHapoalimEnrichment } from './hapoalim-enrichment.mjs';
import { createHapoalimAccountReader } from './hapoalim-accounts.mjs';
import {createChequeImages} from './cheque-images.mjs';
import {createInstalledBrowserLocator} from './browser-locator.mjs';
import {browserCandidates} from './windows-browser.mjs';
import { createHapoalimSessionAdapter } from './hapoalim-session.mjs';
import { createHapoalimProvider } from './hapoalim-provider.mjs';
import {createCreditProfileSession} from './credit-session.mjs';
import {createCreditProvider} from './credit-provider.mjs';
import {createBridgeShutdownOwner} from './shutdown-owner.mjs';
import {createBridgeReplacementCommand} from './replacement-command.mjs';
import {isLoopbackPortClosed} from './loopback-port.mjs';
import {createBankBridgeHttpHandler} from './http-handler.mjs';
import {createBankBridgeRoutes} from './http-routes.mjs';
import {createConnectionQueries} from './connection-queries.mjs';
import {createFinanceCommands} from './finance-commands.mjs';
import {createDiagnosticQueries} from './diagnostic-queries.mjs';
import http from 'node:http';
import {createBridgeOperationOwner} from './operation-owner.mjs';
import {createConnectionVault} from './connection-vault.mjs';
import {createConnectionCommands,settleConnectionJobs} from './connection-commands.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {runProcess,protectText,unprotectText} from './windows-platform.mjs';
import {randomBytes} from 'node:crypto';
import { scraperFailureMessage } from './hapoalim-failure-policy.mjs';
import { waitForTerminalLoginResult } from './hapoalim-login-runtime.mjs';
import {doctorCamoufox} from './isracard-camoufox.mjs';
import { CREDIT_CONNECTOR_CONTRACT_VERSION } from './credit-adapter-wire.mjs';
import { createCreditProviderAdapter } from './credit-adapter-factory.mjs';
import { createCreditDiagnosticLog } from './credit-diagnostic-log.mjs';
import {creditIdentityDirectory,deleteCreditIdentity,resetCreditIdentities} from './credit-identity.mjs';
import {createBankDiagnosticRun,finishBankDiagnosticRun,recordBankAccountDiagnostic,recordBankTransactionDiagnostic} from './bank-diagnostics.mjs';

const HOST='127.0.0.1';
const PORT=8765;
const BRIDGE_VERSION=73;
const BROWSER_IDENTITY_PROBE_URL=`http://${HOST}:${PORT}/health`;
const APP_DIR=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimKupaBankBridge');
const TOKEN_FILE=path.join(APP_DIR,'bridge-token.txt');
const BROWSER_PROFILE_DIR=path.join(APP_DIR,'browser-profile');
const CAMOUFOX_INSTALL_DIR=path.join(APP_DIR,'camoufox');
const CREDIT_IDENTITIES_DIR=path.join(APP_DIR,'credit-identities');
const CHEQUE_IMAGE_CACHE_DIR=path.join(APP_DIR,'cheque-image-cache');
const creditDiagnostics=createCreditDiagnosticLog({directory:path.join(APP_DIR,'diagnostics'),bridgeVersion:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION});
process.env.CAMOUFOX_INSTALL_DIR=process.env.CAMOUFOX_INSTALL_DIR||CAMOUFOX_INSTALL_DIR;
const operations=createBridgeOperationOwner();
const artifacts=createBridgeArtifacts({directory:APP_DIR});
const readMeta=artifacts.bankMeta.read,writeMeta=artifacts.bankMeta.write;
const readCreditMeta=artifacts.creditMeta.read,writeCreditMeta=artifacts.creditMeta.write;
const readBankDiagnostic=artifacts.bankDiagnostic.read,writeBankDiagnostic=artifacts.bankDiagnostic.write,deleteBankDiagnostic=artifacts.bankDiagnostic.clear;
const readCreditDataDiagnostic=artifacts.creditData.read,writeCreditDataDiagnostic=artifacts.creditData.write,deleteCreditDataDiagnostic=artifacts.creditData.clear;

const images=createChequeImages({directory:CHEQUE_IMAGE_CACHE_DIR,clock:{date:()=>new Date(),now:()=>Date.now()},reporter:(label,error)=>console.error(label,error)});
const browserLocator=createInstalledBrowserLocator({platform:{os:process.platform,candidates:browserCandidates,access:filename=>fs.access(filename),where:name=>runProcess('where.exe',[name])},metadata:{read:readMeta,write:writeMeta}});
const vault=createConnectionVault({directory:APP_DIR,protectText,unprotectText});
const connections=createConnectionCommands({operations,vault,artifacts:{
  writeBankMeta:writeMeta,
  clearCreditData:deleteCreditDataDiagnostic,
  creditIdentity:profile=>creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile),
  deleteCreditIdentity:profile=>deleteCreditIdentity(CREDIT_IDENTITIES_DIR,profile),
  clearBank:()=>settleConnectionJobs([deleteBankDiagnostic(),images.clear()]),
  resetCredit:()=>settleConnectionJobs([artifacts.creditMeta.clear(),deleteCreditDataDiagnostic(),resetCreditIdentities(CREDIT_IDENTITIES_DIR)]),
  clearImported:clearImportedConnectionArtifacts,
}});
let activeServer=null;

async function ensureAppDir(){await fs.mkdir(APP_DIR,{recursive:true,mode:0o700})}
async function ensureToken(){
  await ensureAppDir();
  try{const token=(await fs.readFile(TOKEN_FILE,'utf8')).trim();if(token)return token}catch{}
  const token=randomBytes(32).toString('base64url');
  await fs.writeFile(TOKEN_FILE,token+'\n',{encoding:'utf8',mode:0o600});
  return token;
}

async function clearImportedConnectionArtifacts(){
  const cleanupJobs=[
    ['bank-meta',writeMeta({lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,lastAvailableAccounts:[],lastAccountRole:''})],
    ['credit-meta',artifacts.creditMeta.clear()],
    ['credit-data-diagnostic',deleteCreditDataDiagnostic()],
    ['bank-diagnostic',deleteBankDiagnostic()],
    ['cheque-image-cache',images.clear()],
    ['credit-browser-identities',resetCreditIdentities(CREDIT_IDENTITIES_DIR)],
  ];
  const cleanupResults=await Promise.allSettled(cleanupJobs.map(([,job])=>job));
  const cleanupWarnings=cleanupResults.flatMap((result,index)=>result.status==='rejected'?[cleanupJobs[index][0]]:[]);
  return cleanupWarnings;
}

async function doctorModernPuppeteer(browserPath){
  const imported=await import('puppeteer-modern'),puppeteer=imported.default||imported;
  if(typeof puppeteer?.launch!=='function')throw new Error('puppeteer-modern did not expose a compatible launch API');
  let browser=null;
  try{
    browser=await puppeteer.launch({headless:true,executablePath:browserPath,args:['--no-first-run','--no-default-browser-check']});
    const version=String(await browser.version()||'').trim();
    if(!version)throw new Error('puppeteer-modern launched the browser but did not return a browser version');
    return version;
  }finally{if(browser)try{await browser.close()}catch{}}
}

async function fetchLocal(pathname,{method='GET',token='',timeoutMs=1200}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`http://${HOST}:${PORT}${pathname}`,{method,headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:controller.signal});
    const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
    return {response,data};
  }finally{clearTimeout(timer)}
}
async function waitForPortToClose(timeoutMs=5000){
  const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(await isLoopbackPortClosed({host:HOST,port:PORT}))return true;await new Promise(r=>setTimeout(r,150))}return false;
}
const replacement=createBridgeReplacementCommand({
  probe:async()=>{try{return await fetchLocal('/health')}catch(error){if(await isLoopbackPortClosed({host:HOST,port:PORT}))return null;throw error}},readToken:()=>fs.readFile(TOKEN_FILE,'utf8'),
  shutdown:token=>fetchLocal('/shutdown',{method:'POST',token,timeoutMs:1500}),
  waitUntilStopped:()=>waitForPortToClose(),
});

const providerBrowser={
  findInstalled:browserLocator.find,
  loadScrapers:()=>import('israeli-bank-scrapers'),
  profileDirectory:BROWSER_PROFILE_DIR,
  ensureProfile:async()=>{await fs.mkdir(BROWSER_PROFILE_DIR,{recursive:true})},
  identityProbeUrl:BROWSER_IDENTITY_PROBE_URL,
};
const bankSession=createHapoalimSessionAdapter({
  metadata:{read:readMeta},
  clock:{now:()=>Date.now(),delay:ms=>new Promise(resolve=>setTimeout(resolve,ms))},
  waitForTerminal:waitForTerminalLoginResult,
});
const enableHapoalimSessionAwareLogin=bankSession.decorate;
const bankJson=createHapoalimJsonReader({session:bankSession});
const bankEnrichment=createHapoalimEnrichment({json:bankJson,cheques:images,diagnostics:{recordTransaction:recordBankTransactionDiagnostic}});
const bankAccounts=createHapoalimAccountReader({session:bankSession,json:bankJson,enrichment:bankEnrichment,diagnostics:{recordAccount:recordBankAccountDiagnostic},clock:{date:()=>new Date()}});
const bankProvider=createHapoalimProvider({
  browser:providerBrowser,
  session:{...bankSession,failureMessage:scraperFailureMessage},
  accounts:bankAccounts,
  diagnostics:{
    create:createBankDiagnosticRun,
    finish:finishBankDiagnosticRun,
    write:writeBankDiagnostic,
    report:(label,error)=>console.error(label,error?.message||error),
  },
  cache:{cleanup:images.cleanup},
  metadata:{write:writeMeta},
  version:BRIDGE_VERSION,
});
const creditSession=createCreditProfileSession({
  browser:providerBrowser,
  identity:{directory:profile=>creditIdentityDirectory(CREDIT_IDENTITIES_DIR,profile)},
  createAdapter:createCreditProviderAdapter,
  diagnostics:creditDiagnostics,
});
const creditProvider=createCreditProvider({
  sessions:creditSession,
  identity:{remove:profile=>deleteCreditIdentity(CREDIT_IDENTITIES_DIR,profile)},
  diagnostics:creditDiagnostics,
});

const args=new Set(process.argv.slice(2));
if(args.has('--stop-existing')){try{await replacement.stop();process.exit(0)}catch(e){console.error(e?.message||e);process.exit(1)}}
if(args.has('--doctor')){
  try{
    const browserPath=await browserLocator.find();
    const digitalV3BrowserVersion=await doctorModernPuppeteer(browserPath);
    const pkg=await import('israeli-bank-scrapers');
    if(!pkg?.createScraper||!pkg?.CompanyTypes?.hapoalim||!pkg?.CompanyTypes?.visaCal||!pkg?.CompanyTypes?.max||!pkg?.CompanyTypes?.isracard||!pkg?.CompanyTypes?.amex)throw new Error('israeli-bank-scrapers did not expose required Hapoalim/Cal/Max/Isracard/Amex support');
    const probe=pkg.createScraper({companyId:pkg.CompanyTypes.hapoalim,startDate:new Date(),showBrowser:false,executablePath:browserPath});
    enableHapoalimSessionAwareLogin(probe,{interactive:true});
    if(typeof probe.initialize!=='function'||typeof probe.login!=='function'||typeof probe.terminate!=='function')throw new Error('Hapoalim scraper lifecycle API is incompatible');
    await doctorCamoufox();
    console.log(`Browser: ${browserPath}`);
    console.log(`DigitalV3 Puppeteer: ${digitalV3BrowserVersion}`);
    console.log(`Camoufox: ${CAMOUFOX_INSTALL_DIR}`);
    console.log('Scraper: Hapoalim + Cal + Max + Isracard native/fallback + Amex Camoufox support, secure multi-profile credit sync, session-aware bank reads OK');
    process.exit(0);
  }catch(e){console.error(e?.message||e);process.exit(1)}
}

const token=await ensureToken();
if(args.has('--init')||args.has('--print-token')){console.log('Bank Bridge key:');console.log(token);console.log(`Credentials directory: ${APP_DIR}`);process.exit(0)}

const service=createConnectionQueries({operations,vault,metadata:{bank:readMeta,credit:readCreditMeta}});
const finance=createFinanceCommands({operations,
  bank:{readCredentials:vault.readCredentials,scrape:bankProvider.read,writeMeta},
  credit:{readProfiles:vault.readCreditProfiles,readMeta:readCreditMeta,scrape:creditProvider.scrape,writeDataDiagnostic:writeCreditDataDiagnostic,writeMeta:writeCreditMeta},
});
const diagnostics=createDiagnosticQueries({creditLog:creditDiagnostics,read:{bank:readBankDiagnostic,creditData:readCreditDataDiagnostic}});
const shutdown=createBridgeShutdownOwner({operations,diagnostics:{drain:async()=>{await Promise.all([creditDiagnostics.drain(),images.drain(),artifacts.drain()])}},platform:{
  schedule:(run,delayMs)=>{const timer=setTimeout(run,delayMs);return ()=>clearTimeout(timer)},
  subscribeStop:listener=>{process.on('SIGINT',listener);process.on('SIGTERM',listener);return ()=>{process.off('SIGINT',listener);process.off('SIGTERM',listener)}},
  closeListener:()=>new Promise((resolve,reject)=>activeServer.close(error=>error?reject(error):resolve())),
  exit:()=>process.exit(0),reportError:error=>console.error('Bank Bridge shutdown failed; accepted work was not force-stopped:',error?.message||error),
}});
const routes=createBankBridgeRoutes({version:BRIDGE_VERSION,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION,
  service,connections,finance,diagnostics,
  cheques:{read:async key=>{const image=await images.read(key);return image&&images.inRetention(image.eventDate)?image:null}},
  shutdown:{afterResponse:()=>{void shutdown.request()}},
});
const handler=createBankBridgeHttpHandler({token,routes,admission:{assertAccepting:operations.assertAccepting},health:()=>({ok:true,service:'netunim-kupa-bank-bridge',version:BRIDGE_VERSION,creditContractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION})});
activeServer=http.createServer(handler);
shutdown.start();
activeServer.on('error',e=>{if(e?.code==='EADDRINUSE'){console.error(`Bank Bridge already appears to be running on ${HOST}:${PORT}`);process.exit(0)}console.error(e);process.exit(1)});
activeServer.listen(PORT,HOST,()=>console.log(`Netunim Kupa Bank Bridge v${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`));
