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
 return ts.getPreEmitDiagnostics(ts.createProgram([path.join(root,'tests/fixtures/checked-finance-transactions.mjs')],parsed.options,host));
}
const describe=diagnostics=>ts.formatDiagnostics(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'});
test('actual Finance queue and RPC bodies check with negative consumers in both applications',()=>{const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics))});
for(const [name,from,to] of [
 ['finance-lease-transport.js','return readFinanceLeaseRelease(value);',"return 'released';"],
 ['finance-lease-transport.js','return readFinanceLeaseReceipt(value,{leaseName:name,leaseToken:token});','return value;'],
 ['finance-fence.js','return Object.freeze({acquired:true,leaseName,leaseToken,fenceEpoch});',"return Object.freeze({acquired:true,leaseName,leaseToken,fenceEpoch:'7'});"],
 ['finance-fence.js','return ()=>{const live=observe(readOnly);','return async ()=>{const live=observe(readOnly);'],
])test('strict Finance implementation rejects '+to,()=>{
 const file=path.join(root,'shared',name),original=readFileSync(file,'utf8'),mutated=original.replace(from,to);assert.notEqual(mutated,original);
 const diagnostics=check(file,mutated);assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===file&&[2322,2345].includes(item.code)),describe(diagnostics));
});
