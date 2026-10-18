import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const modules=process.env.NETUNIM_OFFLINE_NODE_MODULES||path.join(root,'node_modules');
const ts=createRequire(import.meta.url)(path.join(modules,'typescript/lib/typescript.js'));
const config=ts.readConfigFile(path.join(root,'tsconfig.contracts.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const file=path.join(root,'shared/indexed-db-connection.js');
function check(source){
  const host=ts.createCompilerHost(parsed.options),read=host.readFile;
  if(source)host.readFile=name=>path.resolve(name)===file?source:read(name);
  return ts.getPreEmitDiagnostics(ts.createProgram([path.join(root,'tests/fixtures/checked-idb-receipts.mjs')],parsed.options,host));
}
test('actual receipt implementation and generated consumers pass strict negative contracts',()=>{
  assert.deepEqual(check(),[]);
});
test('strict implementation rejects a hard-coded receipt replacing the prepared value',()=>{
  const original=readFileSync(file,'utf8'),mutated=original.replace('resolve(outcome.value)',"resolve('saved')");
  assert.notEqual(original,mutated);
  assert.ok(check(mutated).some(item=>item.file&&path.resolve(item.file.fileName)===file&&item.code===2345));
});
