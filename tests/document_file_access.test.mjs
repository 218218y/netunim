import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDocumentFileAccess} from '../netunim-orders/document-bridge/file-access-policy.mjs';
import {createDocumentResultRegistry} from '../netunim-orders/document-bridge/result-registry.mjs';

test('document access checks real files, sibling prefixes, junction escapes and permission revocation',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'document-access-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const root=path.join(temporary,'business'),outside=path.join(temporary,'business-private');
  await fs.mkdir(root);await fs.mkdir(outside);
  const invoice=path.join(root,'invoice.txt'),secret=path.join(outside,'private.txt');
  await fs.writeFile(invoice,'synthetic invoice');await fs.writeFile(secret,'private synthetic file');
  let config={roots:[{path:root}]};
  const access=createDocumentFileAccess({loadConfig:async()=>config});
  assert.equal(await access.authorize(invoice),await fs.realpath(invoice));
  await assert.rejects(access.authorize(secret),{code:'DOCUMENT_PATH_FORBIDDEN'});
  await assert.rejects(access.authorize(path.join(root,'..','business-private','private.txt')),{code:'DOCUMENT_PATH_FORBIDDEN'});
  const link=path.join(root,'escape');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(access.authorize(path.join(link,'private.txt')),{code:'DOCUMENT_PATH_FORBIDDEN'});
  assert.deepEqual((await access.admit([{fullPath:invoice},{fullPath:secret},{fullPath:path.join(link,'private.txt')}])).map(row=>row.fullPath),[invoice]);
  const registry=createDocumentResultRegistry({clock:{now:()=>1,ttlMs:100},identity:{next:()=> 'opaque'},files:{stat:fs.stat,authorize:access.authorize}});
  const result=registry.publish({fullPath:invoice,name:'invoice',relativePath:'business',modified:'',size:0,extension:'txt'},{query:'invoice',mode:'everything',contentSearch:{matchMode:'phrase',wordMatch:'partial',proximityWords:0}});
  await registry.resolve(result.id);
  config={roots:[]};
  await assert.rejects(registry.resolve(result.id),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
  await assert.rejects(access.admit([]),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
  config={roots:[{path:outside}]};
  await assert.rejects(registry.resolve(result.id),{code:'DOCUMENT_PATH_FORBIDDEN'});
  assert.equal(await fs.readFile(secret,'utf8'),'private synthetic file');
});

test('whole-drive consent, protected directories and live visibility also gate stored result IDs', {skip:process.platform!=='win32'}, async()=>{
  const root='C:\\', invoice='C:\\Users\\owner\\Downloads\\invoice.pdf';
  const protectedFile='C:\\WINDOWS\\System32\\system.txt', bridgeFile='C:\\Users\\owner\\NetunimSecurity\\key.dpapi';
  const hidden='C:\\Users\\owner\\Downloads\\hidden.pdf', junction='C:\\Users\\owner\\Downloads\\alias.txt';
  let config={roots:[root]}, hiddenNow=false;
  const access=createDocumentFileAccess({
    loadConfig:async()=>config,
    files:{realpath:async target=>target===junction?protectedFile:target,stat:async()=>({isDirectory:()=>true})},
    visible:async targets=>targets.map(target=>target!==hidden&&(!hiddenNow||target!==invoice))
  });
  await assert.rejects(access.authorize(invoice),{code:'DOCUMENT_PATH_FORBIDDEN'});
  config={...config,allowDriveRoots:true};
  assert.equal(await access.authorize(invoice),invoice);
  for(const candidate of [protectedFile,bridgeFile,hidden,junction])await assert.rejects(access.authorize(candidate),{code:'DOCUMENT_PATH_FORBIDDEN'});
  const admitted=await access.admit([invoice,protectedFile,bridgeFile,hidden,junction].map(fullPath=>({fullPath})));
  assert.deepEqual(admitted,[{fullPath:invoice}]);
  const registry=createDocumentResultRegistry({clock:{now:()=>1,ttlMs:100},identity:{next:()=> 'opaque'},files:{stat:async()=>({}),authorize:access.authorize}});
  const result=registry.publish({fullPath:invoice},{query:'invoice',mode:'everything',contentSearch:{}});
  await registry.resolve(result.id);
  hiddenNow=true;
  await assert.rejects(registry.resolve(result.id),{code:'DOCUMENT_PATH_FORBIDDEN'});
});

test('mapped drive rows retain their indexed path and reauthorize the live UNC target', {skip:process.platform!=='win32'}, async()=>{
  const root='Y:\\',file='Y:\\Documents\\report.pdf',share='\\\\server\\share\\',target=share+'Documents\\report.pdf';
  let configured=true;
  const access=createDocumentFileAccess({
    loadConfig:async()=>({roots:configured?[root]:[],allowDriveRoots:true}),
    files:{realpath:async candidate=>candidate===root?share:target,stat:async()=>({isDirectory:()=>true})}
  });
  const [row]=await access.admit([{fullPath:file}]);
  assert.equal(row.fullPath,file);
  const registry=createDocumentResultRegistry({clock:{now:()=>1,ttlMs:100},identity:{next:()=> 'opaque'},files:{stat:async()=>({}),authorize:access.authorize}});
  const result=registry.publish(row,{query:'report',mode:'everything',contentSearch:{}});
  const resolved=await registry.resolve(result.id);
  assert.equal(resolved.row.fullPath,target);
  assert.equal(resolved.row.indexedPath,file);
  configured=false;
  await assert.rejects(registry.resolve(result.id),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
});
