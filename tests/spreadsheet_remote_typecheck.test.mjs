import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),modules=process.env.NETUNIM_OFFLINE_NODE_MODULES||path.join(root,'node_modules');
const ts=createRequire(import.meta.url)(path.join(modules,'typescript/lib/typescript.js'));
const config=ts.readConfigFile(path.join(root,'tsconfig.contracts.json'),ts.sys.readFile);assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);assert.deepEqual(parsed.errors,[]);
function check(file,source){
  const host=ts.createCompilerHost(parsed.options),read=host.readFile;
  if(file)host.readFile=name=>path.resolve(name)===file?source:read(name);
  return ts.getPreEmitDiagnostics(ts.createProgram([path.join(root,'tests/fixtures/checked-spreadsheet-remote.mjs')],parsed.options,host));
}
const describe=diagnostics=>ts.formatDiagnostics(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'});
test('actual spreadsheet RPC implementation and both generated consumers check with negative consumers',()=>{
  const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics));
});
for(const [from,to] of [
  ['return {revision:version,state,',"return {revision:'7',state,"],
  ['const version=revision(value.revision,0),state=decodeState(value.state);','const version=revision(value.revision,0),state=value.state;'],
  ['return {...result,operation_replayed:replayed};',"return {...result,operation_replayed:'true'};"],
  ['const assertCurrent=access.capture();assertCurrent();','const assertCurrent=async()=>{};assertCurrent();'],
])test('strict spreadsheet implementation rejects '+to,()=>{
  const file=path.join(root,'shared/spreadsheet-remote.js'),original=readFileSync(file,'utf8'),mutated=original.replace(from,to);assert.notEqual(mutated,original);
  const diagnostics=check(file,mutated);assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===file&&[2322,2345].includes(item.code)),describe(diagnostics));
});
