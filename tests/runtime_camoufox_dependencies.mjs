// Explicit locked-dependency CI probe; no installed browser/profile or provider
// is opened. This file runs after npm ci for the Bank Bridge, not in model shards.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(new URL('../netunim-kupa/bank-bridge/package.json',import.meta.url));
const camoufoxRequire=createRequire(require.resolve('camoufox-js'));
const globModule=await import(pathToFileURL(camoufoxRequire.resolve('glob')).href);
const globPackage=JSON.parse(await fs.readFile(camoufoxRequire.resolve('glob/package.json'),'utf8'));
assert.equal(globPackage.version,'14.0.2');
const globRequire=createRequire(camoufoxRequire.resolve('glob'));
assert.equal(JSON.parse(await fs.readFile(globRequire.resolve('minimatch/package.json'),'utf8')).version,'11.0.5');
const camoufox=await import(pathToFileURL(require.resolve('camoufox-js')).href);
assert.equal(typeof camoufox.Camoufox,'function');assert.equal(typeof camoufox.launchOptions,'function');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-glob-compatibility-'));
try{
  for(let i=0;i<20;i++){
    const directory=path.join(root,`synthetic-${i}`);await fs.mkdir(directory);
    await fs.writeFile(path.join(directory,'בדיקה.json'),'{}');
  }
  assert.equal((await globModule.glob('**/*.json',{cwd:root})).length,20);
  assert.equal(globModule.globSync('**/*.json',{cwd:root}).length,20);
  const controller=new AbortController();let traversals=0,afterAbort=0;
  await assert.rejects(globModule.glob('**/*',{cwd:root,signal:controller.signal,fs:{
    readdir:(directory,options,callback)=>{
      traversals++;if(controller.signal.aborted)afterAbort++;
      nativeFs.readdir(directory,options,(error,rows)=>{controller.abort();callback(error,rows)});
    },
  }}),{name:'AbortError'});
  await delay(30);
  assert.equal(traversals,1);assert.equal(afterAbort,0,'aborted traversal must not keep reading child directories');
  console.log('PASS locked Camoufox imports, Unicode glob APIs and cancellation stop at the first read');
}finally{
  assert.ok(path.isAbsolute(root)&&!path.relative(os.tmpdir(),root).startsWith('..'));
  await fs.rm(root,{recursive:true,force:true});
}
