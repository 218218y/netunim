// Explicit CI suite: requires bank dependencies and a real Chromium executable.
// Never navigates to a provider or opens any installed browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.env.NETUNIM_DEPENDENCY_ROOT?pathToFileURL(path.join(process.env.NETUNIM_DEPENDENCY_ROOT,'package.json')):new URL('../netunim-kupa/bank-bridge/package.json',import.meta.url));
const {createScraper,CompanyTypes}=require('israeli-bank-scrapers');
const manifest=JSON.parse(await fs.readFile(require.resolve('./package.json'),'utf8'));
assert.equal(JSON.parse(await fs.readFile(require.resolve('israeli-bank-scrapers/package.json'),'utf8')).version,manifest.dependencies['israeli-bank-scrapers']);
// Netunim uses the published login/page APIs with its own data readers. Check
// those actual package boundaries without sending credentials or provider traffic.
for(const provider of ['hapoalim','visaCal','max']){
  const instance=createScraper({companyId:CompanyTypes[provider],startDate:new Date()});
  for(const method of ['initialize','login','terminate'])assert.equal(typeof instance[method],'function',`${provider}.${method}`);
  if(provider==='visaCal')for(const method of ['getLoginOptions','getCards','getAuthorizationHeader','getXSiteId'])
    assert.equal(typeof instance[method],'function',`visaCal.${method}`);
}
const packageFile=require.resolve('puppeteer/package.json');
assert.equal(JSON.parse(await fs.readFile(packageFile,'utf8')).version,manifest.dependencies.puppeteer);
const modernPackageFile=require.resolve('puppeteer-modern/package.json');
const modernVersion=JSON.parse(await fs.readFile(modernPackageFile,'utf8')).version;
assert.equal('npm:puppeteer@'+modernVersion,manifest.dependencies['puppeteer-modern']);
const modern=await import(pathToFileURL(require.resolve('puppeteer-modern')).href);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-dependency-smoke-'));
let scraper;
try{
  assert.ok(process.env.NETUNIM_BROWSER,'a real Chromium executable is required');
  const browser=await modern.default.launch({
    headless:true,
    executablePath:process.env.NETUNIM_BROWSER,
    args:['--no-sandbox'],
    userDataDir:path.join(directory,'digital-v3'),
  });
  try{
    assert.match(await browser.version(),/^(?:HeadlessChrome|Chrome|Chromium|Edg|Edge)\/\d/);
  }finally{
    await browser.close();
  }
  scraper=createScraper({companyId:CompanyTypes.hapoalim,startDate:new Date(),combineInstallments:false,
    executablePath:process.env.NETUNIM_BROWSER,showBrowser:false,args:['--no-sandbox',`--user-data-dir=${path.join(directory,'scraper')}`],
    preparePage:async page=>{await page.setRequestInterception(true);page.on('request',request=>{
      if(request.url().startsWith('data:')||request.url()==='about:blank')void request.continue();else void request.abort();
    })}});
  await scraper.initialize();
  await scraper.page.goto('data:text/html,<input id="synthetic" value="isolated">');
  assert.equal(await scraper.page.$eval('#synthetic',element=>element.value),'isolated');
  await scraper.page.setUserAgent({userAgent:'Netunim synthetic compatibility probe'});
  assert.equal(await scraper.page.evaluate(()=>navigator.userAgent),'Netunim synthetic compatibility probe');
  console.log('PASS both locked Puppeteer packages launch Chromium in disposable profiles; no provider navigation');
}finally{
  if(scraper)await scraper.terminate(true);
  await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
