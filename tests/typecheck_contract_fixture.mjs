// Shared compiler fixture. Every mutation still builds and checks a fresh
// program; only independent test registration is split across worker processes.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

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


export {root, fixture, check, describe};
