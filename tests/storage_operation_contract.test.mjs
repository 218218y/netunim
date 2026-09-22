import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';

const ROOT=path.resolve(import.meta.dirname,'..');
const SAVE_CALLS=new Set(['saveState','saveChecksState','scheduleSave','scheduleCheckSave']);

function walk(node,visit){
  if(!node||typeof node!=='object')return;
  visit(node);
  for(const value of Object.values(node)){
    if(Array.isArray(value))for(const child of value)walk(child,visit);
    else if(value&&typeof value==='object'&&value.type)walk(value,visit);
  }
}

function operationContractFailures(){
  const failures=[];
  for(const app of ['netunim-kupa','netunim-orders']){
    const sourceRoot=path.join(ROOT,app,'site','assets','js');
    for(const relative of fs.readdirSync(sourceRoot,{recursive:true}).filter(file=>file.endsWith('.js'))){
      if(relative.replaceAll('\\','/').endsWith('shared/notes-workbook.js'))continue; // separate spreadsheet journal
      const file=path.join(sourceRoot,relative),source=fs.readFileSync(file,'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});
      walk(ast,node=>{
        if(node.type!=='CallExpression'||node.callee.type!=='Identifier'||!SAVE_CALLS.has(node.callee.name))return;
        const options=node.arguments[1],declared=options?.type==='ObjectExpression'&&options.properties.some(property=>['operations','storageBoundary'].includes(property.key?.name||property.key?.value));
        if(!declared)failures.push(`${path.relative(ROOT,file)}:${node.loc.start.line} ${node.callee.name}`);
      });
    }
  }
  return failures;
}

test('every application mutation owner declares complete operations or an explicit checkpoint boundary',()=>{
  assert.deepEqual(operationContractFailures(),[]);
});

test('persistence never infers a complete delete operation from mutationType or delete intents',()=>{
  for(const relative of ['netunim-kupa/site/assets/js/storage/persistence.js','netunim-orders/site/assets/js/storage/persistence.js']){
    const source=fs.readFileSync(path.join(ROOT,relative),'utf8');
    assert.doesNotMatch(source,/mutationType\s*===?\s*['"](?:bulk-)?delete['"][\s\S]{0,500}operations\s*=/);
  }
});
