import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

const root=fileURLToPath(new URL('../',import.meta.url));
const forbidden=new Set(['fetch','indexedDB','localStorage','sessionStorage',
  'XMLHttpRequest','WebSocket','Worker','setTimeout','setInterval','window','self','globalThis']);

// This enforces the deterministic action-entry subset of FEATURE_ENTRY_CONTRACT.
// Business validation, receipts and continuation lifetimes need owner tests too.
export function auditFeatureEntry(source,file='action-pack.js'){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true,locations:true});
  const failures=[],actions=[];
  const fail=(node,rule)=>failures.push({file,line:node.loc.start.line,rule});
  const scope=analyze(ast,{ecmaVersion:2022,sourceType:'module',optimistic:true});
  for(const reference of scope.globalScope.through){
    if(forbidden.has(reference.identifier.name))fail(reference.identifier,`raw-effect:${reference.identifier.name}`);
  }
  function tail(node,name){
    if(!node)return;
    if(node.type==='BlockStatement')tail(node.body.at(-1),name);
    else if(node.type==='IfStatement'){tail(node.consequent,name);tail(node.alternate,name)}
    else if(node.type==='TryStatement'){
      tail(node.block,name);tail(node.handler?.body,name);tail(node.finalizer,name);
    }else if(node.type==='SwitchStatement'){
      for(const branch of node.cases)tail(branch.consequent.at(-1),name);
    }else if(node.type==='ExpressionStatement'&&
      ['CallExpression','ChainExpression','AwaitExpression'].includes(node.expression.type)){
      fail(node,`discarded-completion:${name}`);
    }
  }
  function walk(node){
    if(!node?.type)return;
    if(node.type==='ImportDeclaration'||node.type==='ImportExpression'){
      const target=node.source.type==='Literal'?node.source.value:null;
      if(typeof target!=='string'||!target.startsWith('../../shared/')||
        /\/(?:storage-|cloud-|bank-bridge|document-bridge|spreadsheet-(?:store|remote|sync)|finance-lease)/.test(target)){
        fail(node,'owner-bypass-import');
      }
    }
    if(node.type==='Property'&&typeof node.key.value==='string'&&
      /^[a-z][a-z0-9-]*$/.test(node.key.value)&&
      ['ArrowFunctionExpression','FunctionExpression'].includes(node.value.type)){
      actions.push(node.key.value);
      tail(node.value.body,node.key.value);
    }
    for(const value of Object.values(node)){
      for(const child of Array.isArray(value)?value:[value])if(child?.type)walk(child);
    }
  }
  walk(ast);
  return {file,actions,failures};
}

export function auditApplicationEntries(repository=root){
  return ['orders','kupa'].flatMap(app=>{
    const directory=`netunim-${app}/site/assets/js/ui/action-packs`;
    return fs.readdirSync(path.join(repository,directory)).filter(name=>name.endsWith('.js')).sort().map(name=>{
      const file=`${directory}/${name}`;
      return auditFeatureEntry(fs.readFileSync(path.join(repository,file),'utf8'),file);
    });
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=auditApplicationEntries();
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else for(const row of report)console.log(`${row.file}: ${row.actions.length} actions, ${row.failures.length} violations`);
  if(report.some(row=>row.failures.length))process.exitCode=1;
}
