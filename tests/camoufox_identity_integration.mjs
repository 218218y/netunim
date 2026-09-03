import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyCamoufoxIdentityContinuity} from '../netunim-kupa/bank-bridge/isracard-camoufox.mjs';

const appRoot=path.join(process.env.LOCALAPPDATA||'', 'NetunimKupaBankBridge');
const runtimeModule=process.env.NETUNIM_CAMOUFOX_MODULE||path.join(appRoot,'app','node_modules','camoufox-js','dist','index.js');
const browserRoot=process.env.CAMOUFOX_INSTALL_DIR||path.join(appRoot,'camoufox');

try{await fs.access(runtimeModule);await fs.access(browserRoot)}catch{
  console.log('SKIP Camoufox identity integration: installed Camoufox 0.12.0 runtime/browser not found');
  process.exit(0);
}

process.env.CAMOUFOX_INSTALL_DIR=browserRoot;
const {Camoufox}=await import(pathToFileURL(runtimeModule).href);
assert.equal(typeof Camoufox,'function','installed camoufox-js must expose Camoufox');
const identityDir=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-camoufox-integration-'));
try{
  const result=await verifyCamoufoxIdentityContinuity(Camoufox,{identityDir});
  assert.equal(result.stable,true);
  assert.ok(result.fields.includes('userAgent'));
  console.log(`PASS Camoufox identity integration: ${result.fields.join(', ')} remained stable across two real launches`);
}finally{
  if(path.basename(identityDir).startsWith('netunim-camoufox-integration-'))await fs.rm(identityDir,{recursive:true,force:true});
}
