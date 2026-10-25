// Optional isolated experiment. Neither compiler nor mutations alter the project.
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const candidateArg=process.argv.indexOf('--candidate-package'),outputArg=process.argv.indexOf('--output');
if(candidateArg<0||!process.argv[candidateArg+1])throw Error('Provide --candidate-package with an already installed isolated TypeScript package directory');
const candidate=path.resolve(process.argv[candidateArg+1]),output=path.resolve(outputArg<0?path.join(root,'.work/typescript-current-comparison'):process.argv[outputArg+1]);
if(!output.startsWith(path.join(root,'.work')+path.sep))throw Error('Comparison output must stay inside this workspace .work directory');
const snapshot=path.join(output,'snapshot');
if(existsSync(snapshot))throw Error('Use a fresh output directory to avoid stale comparison files');
const ts=require(path.join(root,'node_modules/typescript/lib/typescript.js'));
const config=ts.readConfigFile(path.join(root,'tsconfig.contracts.json'),ts.sys.readFile);
if(config.error)throw Error('Cannot read canonical contracts config');
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root),program=ts.createProgram(parsed.fileNames,parsed.options);
if(parsed.errors.length)throw Error('Invalid canonical compiler config');
const files=[...new Set([...program.getSourceFiles().map(file=>path.relative(root,file.fileName)), 'package.json','tsconfig.contracts.json','netunim-kupa/bank-bridge/package.json'])].filter(file=>!file.startsWith('node_modules'+path.sep)&&!file.startsWith('..'+path.sep));
const corpus=createHash('sha256');
for(const relative of files.sort()){
  const source=path.join(root,relative),target=path.join(snapshot,relative),bytes=await readFile(source);
  corpus.update(relative.replaceAll(path.sep,'/')).update('\0').update(bytes);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);
}
const candidatePackage=JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8'));
const commands={authoritative:[process.execPath,path.join(root,'node_modules/typescript/bin/tsc')],candidate:[process.execPath,path.join(candidate,'bin/tsc')]};
async function run(command){
  const start=performance.now();
  return await new Promise((resolve,reject)=>{
    const child=spawn(command[0],[...command.slice(1),'--project','tsconfig.contracts.json','--pretty','false'],{cwd:snapshot,windowsHide:true});let out='';
    child.stdout.on('data',data=>{out+=data});child.stderr.on('data',data=>{out+=data});child.on('error',reject);
    child.on('close',code=>resolve({seconds:Number(((performance.now()-start)/1000).toFixed(3)),exit:code,diagnostics:out.split(/\r?\n/).filter(line=>/error TS\d+:/.test(line)),output:out}));
  });
}
const started=performance.now(),report={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTreePaths:execFileSync('git',['diff','--name-only'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean),corpusSha256:corpus.digest('hex'),roots:parsed.fileNames.length,sourceFiles:files.length,platform:process.platform,arch:process.arch,node:process.version,versions:{authoritative:ts.version,candidate:candidatePackage.version},samples:{authoritative:[],candidate:[]},mutations:[]};
for(let sample=0;sample<2;sample++)for(const compiler of Object.keys(commands)){
  const result=await run(commands[compiler]);report.samples[compiler].push(result);console.log(JSON.stringify({compiler,sample:sample+1,seconds:result.seconds,exit:result.exit,diagnostics:result.diagnostics.length}));
}
const mutations=[
  {name:'asynchronous local commit',file:'shared/storage-v2-runtime.js',from:'committed:write.committed,seq:write.seq',to:'committed:true,seq:write.seq'},
  {name:'missing balance versus zero',file:'shared/kupa-cashflow.js',from:'{balance,projected:null}',to:'{balance,projected:0}'},
  {name:'raw RPC row versus ACK',file:'netunim-orders/site/assets/js/sync/ack-publication.js',from:/readDocumentWriteAck\(res\.row,\{[^\n]+?\}\)/,to:'res.row'},
];
for(const mutation of mutations){
  const file=path.join(snapshot,mutation.file),original=await readFile(file,'utf8'),changed=original.replace(mutation.from,mutation.to);if(changed===original)throw Error('Mutation missing: '+mutation.name);
  const entry={name:mutation.name,file:mutation.file,results:{}};await writeFile(file,changed);
  try{for(const compiler of Object.keys(commands)){
    const result=await run(commands[compiler]),baseline=new Set(report.samples[compiler][0].diagnostics);
    entry.results[compiler]={...result,additionalDiagnostics:result.diagnostics.filter(line=>!baseline.has(line))};
    console.log(JSON.stringify({mutation:mutation.name,compiler,additionalDiagnostics:entry.results[compiler].additionalDiagnostics.length}));
  }}finally{await writeFile(file,original)}report.mutations.push(entry);
}
const candidateApi=require(path.join(candidate,'lib/version.cjs'));
report.integration={legacyCreateProgram:typeof candidateApi.createProgram==='function',offlineFiles:Object.fromEntries(['lib/typescript.js','lib/tsc.js','lib/_tsc.js'].map(file=>[file,existsSync(path.join(candidate,file))])),candidateExports:Object.keys(candidatePackage.exports||{}),fullCiParityMeasured:false};
report.experimentSeconds=Number(((performance.now()-started)/1000).toFixed(3));
await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:path.join(output,'report.json'),experimentSeconds:report.experimentSeconds}));
