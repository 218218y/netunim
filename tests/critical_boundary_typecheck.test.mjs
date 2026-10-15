import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const files=[
  'tests/fixtures/checked-backup-browser.mjs','tests/fixtures/checked-calendar-storage.mjs',
  'tests/fixtures/checked-calendar-persisted.mjs','tests/fixtures/checked-save-publication.mjs',
].map(file=>path.join(root,file));
function check(file,source){
  const host=ts.createCompilerHost(parsed.options),read=host.readFile;
  if(file)host.readFile=name=>path.resolve(name)===file?source:read(name);
  return ts.getPreEmitDiagnostics(ts.createProgram(files,parsed.options,host));
}
const describe=diagnostics=>ts.formatDiagnostics(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'});
test('critical native/persistence implementations and negative consumers compile strictly',()=>{
  const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics));
});
for(const [file,from,to] of [
  ['shared/backup-file-authority.js','return true;','return Promise.resolve(true);'],
  ['shared/backup-browser-resources.js','return value;',"return 'unproven';"],
  ['shared/backup-browser-resources.js','return result;',"return 'unproven';"],
  ['netunim-orders/site/assets/js/calendar/persisted-records.js','return {...decodeCalendarCommand(data),seq};',"return {...decodeCalendarCommand(data),seq:'7'};"],
  ['netunim-orders/site/assets/js/calendar/persisted-records.js',"_calendarAccessRole:calendar.accessRole||''","_calendarAccessRole:true"],
  ['netunim-orders/site/assets/js/calendar/transaction.js','return result','return true'],
  ['netunim-orders/site/assets/js/calendar/storage.js','return seq;',"return '7';"],
  ['netunim-kupa/site/assets/js/storage/save-publication.js','return ok;',"return 'saved';"],
])test(`strict ${file} implementation rejects ${to}`,()=>{
  const source=path.join(root,file),original=readFileSync(source,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(mutated,original,from);const diagnostics=check(source,mutated);
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
});
