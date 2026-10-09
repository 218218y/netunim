import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const modules=process.env.NETUNIM_OFFLINE_NODE_MODULES||path.join(root,'node_modules');
const ts=createRequire(import.meta.url)(path.join(modules,'typescript/lib/typescript.js'));
const config=ts.readConfigFile(path.join(root,'tsconfig.contracts.json'),ts.sys.readFile);
assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
assert.deepEqual(parsed.errors,[]);
const fixture=path.join(root,'tests/fixtures/checked-contracts.mjs');

function check(overrides=new Map()){
  const host=ts.createCompilerHost(parsed.options);
  const read=host.readFile;
  const normalized=new Map([...overrides].map(([file,text])=>[path.resolve(file),text]));
  host.readFile=file=>normalized.get(path.resolve(file))??read(file);
  const program=ts.createProgram(parsed.fileNames,parsed.options,host);
  return ts.getPreEmitDiagnostics(program);
}
function describe(diagnostics){return ts.formatDiagnostics(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'})}

test('strict implementation and consumer checking passes, including every negative type fixture',()=>{
  const diagnostics=check();
  assert.equal(diagnostics.length,0,describe(diagnostics));
});

test('an actual typed implementation mistake is rejected rather than masked by a declaration facade',()=>{
  const source=path.join(root,'shared/cloud-checkpoint-publication.js');
  const diagnostics=check(new Map([[source,readFileSync(source,'utf8')+
    '\n/** @type {number} */\nconst incompatibleRevision="7";\n']]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('a current writer returning a string sequence fails its actual implementation contract',()=>{
  const source=path.join(root,'shared/storage-records.js');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return {version:2,owner,epoch,seq,state,appMetadata,savedAt}',
    'return {version:2,owner,epoch,seq:String(seq),state,appMetadata,savedAt}');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('negative fixture assertions fail if an invalid consumer is accidentally accepted',()=>{
  const diagnostics=check(new Map([[fixture,readFileSync(fixture,'utf8')+
    '\n// @ts-expect-error deliberately unused: must make the gate fail\nconst validRevision=7;\n']]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===fixture&&item.code===2578),describe(diagnostics));
});

test('the command fails closed when the configured offline compiler is absent',()=>{
  const result=spawnSync(process.execPath,[path.join(root,'tools/typecheck.mjs')],{
    cwd:root,encoding:'utf8',env:{...process.env,NETUNIM_OFFLINE_NODE_MODULES:path.join(root,'tests/fixtures/no-installed-node-modules')},
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/MODULE_NOT_FOUND/);
});
