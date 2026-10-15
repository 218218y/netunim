import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

// Analyze the deployed native ESM graph, not a bundler's approximation. Dynamic
// imports and worker entrypoints remain reachable, but are not startup edges.
export function auditStartup(site){
  site=path.resolve(site);
  const graph=new Map(),entry=path.join(site,'assets/app.js');
  const relative=file=>path.relative(site,file).split(path.sep).join('/');
  function read(file){
    if(graph.has(file))return;
    const source=fs.readFileSync(file,'utf8'),edges=[],row={edges,bytes:Buffer.byteLength(source.replace(/\r\n/g,'\n'))};
    graph.set(file,row);
    if(relative(file).startsWith('assets/vendor/'))return;
    const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    function add(spec,eager){
      if(typeof spec!=='string'||!spec.startsWith('.'))throw new Error(`Nonlocal or computed dependency in ${relative(file)}`);
      const target=path.resolve(path.dirname(file),spec);
      if(!target.startsWith(site+path.sep))throw new Error(`Cross-site dependency in ${relative(file)}`);
      edges.push({target,eager});read(target);
    }
    function walk(node){
      if(!node?.type)return;
      if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source)add(node.source.value,true);
      if(node.type==='ImportExpression')add(node.source.type==='Literal'?node.source.value:null,false);
      if(node.type==='NewExpression'&&node.callee.name==='Worker'){
        const url=node.arguments[0];
        if(url?.type!=='NewExpression'||url.callee.name!=='URL')throw new Error('Worker requires a relative URL');
        add(url.arguments[0]?.value,false);
      }
      for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value])if(child?.type)walk(child);
    }
    walk(ast);
  }
  read(entry);
  function closure(eagerOnly,excluded=null){
    const seen=new Set();
    function visit(file){
      if(seen.has(file))return;
      seen.add(file);
      for(const edge of graph.get(file).edges)if(edge!==excluded&&(!eagerOnly||edge.eager))visit(edge.target);
    }
    visit(entry);return seen;
  }
  const firstParty=file=>!relative(file).startsWith('assets/vendor/');
  const summarize=files=>({modules:[...files].filter(firstParty).length,sourceBytes:[...files].filter(firstParty).reduce((sum,file)=>sum+graph.get(file).bytes,0)});
  const startup=closure(true),reachable=closure(false),candidates=[];
  for(const file of startup)for(const edge of graph.get(file).edges){
    if(!edge.eager)continue;
    const remaining=closure(true,edge),exclusive=new Set([...startup].filter(item=>!remaining.has(item))),size=summarize(exclusive);
    if(size.modules)candidates.push({from:relative(file),to:relative(edge.target),...size});
  }
  candidates.sort((a,b)=>b.sourceBytes-a.sourceBytes||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  return {startup:summarize(startup),reachable:summarize(reachable),candidates:candidates.slice(0,20)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(Object.fromEntries(['kupa','orders'].map(app=>[app,auditStartup(`netunim-${app}/site`)])),null,2));
}
