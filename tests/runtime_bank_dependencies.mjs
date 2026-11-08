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
const packageFile=require.resolve('puppeteer/package.json');
assert.equal(JSON.parse(await fs.readFile(packageFile,'utf8')).version,'25.16.0');
const modern=await import(pathToFileURL(require.resolve('puppeteer-modern')).href);
assert.equal(typeof modern.default.launch,'function');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-dependency-smoke-'));
let scraper;
try{
  assert.ok(process.env.NETUNIM_BROWSER,'a real Chromium executable is required');
  scraper=createScraper({companyId:CompanyTypes.hapoalim,startDate:new Date(),combineInstallments:false,
    executablePath:process.env.NETUNIM_BROWSER,showBrowser:false,args:['--no-sandbox',`--user-data-dir=${directory}`],
    preparePage:async page=>{await page.setRequestInterception(true);page.on('request',request=>{
      if(request.url().startsWith('data:')||request.url()==='about:blank')void request.continue();else void request.abort();
    })}});
  await scraper.initialize();
  await scraper.page.goto('data:text/html,<input id="synthetic" value="isolated">');
  assert.equal(await scraper.page.$eval('#synthetic',element=>element.value),'isolated');
  await scraper.page.setUserAgent({userAgent:'Netunim synthetic compatibility probe'});
  assert.equal(await scraper.page.evaluate(()=>navigator.userAgent),'Netunim synthetic compatibility probe');
  console.log('PASS actual scraper initializes and closes Chromium with locked Puppeteer; no provider navigation');
}finally{
  if(scraper)await scraper.terminate(true);
  await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
